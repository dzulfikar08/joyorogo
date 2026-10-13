#!/usr/bin/env ruby
# frozen_string_literal: true

# Xcode-free build of the Expo prebuild + CocoaPods iOS project on Linux.
#
# Reads Pods/Pods.xcodeproj and the app's .xcodeproj exactly as `pod install`
# left them, resolves Release build settings the way Xcode layers them
# (defaults -> project -> xcconfig -> target -> command line) and writes a
# build.ninja that compiles every static-library pod with the Swift
# toolchain's clang/swiftc against the iPhoneOS SDK, runs the pods' script
# phases, assembles resource bundles and links the app executable.
#
#   gen-ninja.rb <ios dir> <build dir> <toolchain.json>
#
# toolchain.json keys: sdk (iPhoneOS.sdk path), clang, swiftc, ar, ld (ld64.lld),
# macro_plugin (Linux build of ExpoModulesMacros-tool), node.

require 'fileutils'
require 'json'
require 'set'
require 'shellwords'
require 'xcodeproj'

IOS = File.expand_path(ARGV.fetch(0))
OUT = File.expand_path(ARGV.fetch(1))
TC = JSON.parse(File.read(ARGV.fetch(2)))
CONFIG = 'Release'
TRIPLE_ARCH = 'arm64'

# Script phases replaced by this build: dSYM path remapping is debug-only
# tooling, the JSI xcframework is cross-built separately (build-ios.sh), and
# the app's bundling/embedding/resources steps are done by build-ios.sh.
SKIPPED_PHASES = [
  /dSYM source maps/,
  /Build ExpoModulesJSI xcframework/,
  /Check Pods Manifest\.lock/,
  /Bundle React Native code and images/,
  /\[CP\] Copy Pods Resources/,
  /\[CP\] Embed Pods Frameworks/,
  /Strip Local Network Keys/,
].freeze
COMPAT_HEADER_PHASE = 'Copy generated compatibility header'

# Build settings with Xcode's layering and $(VAR) expansion.
class Settings
  CONDITIONAL = /\A([A-Za-z0-9_]+)((?:\[[^\]]+\])+)\z/
  VAR = /\$[({]([A-Za-z0-9_]+)(?::([A-Za-z0-9_,=]+))?[)}]/

  attr_reader :layers

  def initialize(layers)
    @layers = layers.map { |layer| normalize(layer) }
    @cache = {}
  end

  def [](key)
    resolve(key, @layers.size - 1, [])
  end

  def list(key)
    split(self[key])
  end

  def yes?(key)
    self[key].strip.upcase == 'YES'
  end

  # A path from a script phase's input/output list: $(VAR), ${VAR}, $VAR.
  def expand(str)
    str.gsub(VAR) { modify(self[Regexp.last_match(1)], Regexp.last_match(2)) }
       .gsub(/\$([A-Za-z_][A-Za-z0-9_]*)/) { self[Regexp.last_match(1)] }
  end

  def keys
    @layers.flat_map(&:keys).uniq
  end

  def split(value)
    Shellwords.split(value)
  rescue ArgumentError
    value.split
  end

  private

  def normalize(layer)
    plain = {}
    conditional = {}
    layer.each do |key, value|
      value = value.join(' ') if value.is_a?(Array)
      value = value.to_s
      if (m = CONDITIONAL.match(key))
        conds = m[2].scan(/\[([^\]]+)\]/).flatten
        conditional[m[1]] = value if conds.all? { |c| condition?(c) }
      else
        plain[key] = value
      end
    end
    plain.merge(conditional)
  end

  def condition?(cond)
    name, pattern = cond.split('=', 2)
    actual = { 'sdk' => 'iphoneos', 'arch' => TRIPLE_ARCH, 'config' => CONFIG }[name]
    actual && File.fnmatch(pattern, actual)
  end

  def resolve(key, top, stack)
    index = top.downto(0).find { |i| @layers[i].key?(key) }
    return '' unless index

    cache_key = [key, index]
    return @cache[cache_key] if @cache.key?(cache_key)
    raise "build setting cycle: #{(stack + [cache_key]).map(&:first).join(' -> ')}" if stack.include?(cache_key)

    inner = stack + [cache_key]
    value = @layers[index][key].gsub(VAR) do
      name = Regexp.last_match(1)
      mods = Regexp.last_match(2)
      resolved = if name == 'inherited'
                   index.zero? ? '' : resolve(key, index - 1, inner)
                 else
                   resolve(name, @layers.size - 1, inner)
                 end
      modify(resolved, mods)
    end
    @cache[cache_key] = value.strip
  end

  def modify(value, mods)
    return value unless mods

    mods.split(',').reduce(value) do |v, mod|
      case mod
      when 'rfc1034identifier' then v.gsub(/[^A-Za-z0-9.-]/, '-')
      when 'c99extidentifier' then v.gsub(/[^A-Za-z0-9_]/, '_').sub(/\A(\d)/, '_\1')
      when 'lower' then v.downcase
      when 'upper' then v.upcase
      when 'dir' then File.dirname(v) + '/'
      when 'file' then File.basename(v)
      when 'base' then File.basename(v, '.*')
      when 'suffix' then File.extname(v)
      when 'standardizepath' then File.expand_path(v)
      when 'quote' then Shellwords.escape(v)
      else v
      end
    end
  end
end

# A native or aggregate target with its resolved settings.
class Target
  attr_reader :pbx, :settings, :project_dir

  def initialize(pbx, project, project_dir)
    @pbx = pbx
    @project_dir = project_dir
    config = pbx.build_configurations.find { |c| c.name == CONFIG }
    project_config = project.build_configurations.find { |c| c.name == CONFIG }
    xcconfig = config.base_configuration_reference ? read_xcconfig(config.base_configuration_reference.real_path.to_s) : {}
    @settings = Settings.new([
      defaults(pbx.name, File.basename(project.path.to_s, '.xcodeproj')),
      project_config.build_settings,
      xcconfig,
      config.build_settings,
      overrides,
    ])
  end

  def name = pbx.name
  def [](key) = settings[key]
  def list(key) = settings.list(key)
  def yes?(key) = settings.yes?(key)
  def split(value) = settings.split(value)

  def native? = pbx.is_a?(Xcodeproj::Project::Object::PBXNativeTarget)

  def product_type
    native? ? pbx.product_type : nil
  end

  def static_library? = product_type == 'com.apple.product-type.library.static'
  def bundle? = product_type == 'com.apple.product-type.bundle'
  def application? = product_type == 'com.apple.product-type.application'

  def sources
    return [] unless native?

    pbx.source_build_phase.files.filter_map do |file|
      next unless file.file_ref

      [file.file_ref.real_path.to_s, (file.settings || {})['COMPILER_FLAGS'].to_s]
    end
  end

  def headers
    return [] unless native? && pbx.respond_to?(:headers_build_phase)

    pbx.headers_build_phase.files.filter_map { |f| f.file_ref&.real_path&.to_s }
  end

  def resources
    return [] unless native?

    pbx.resources_build_phase.files.filter_map { |f| f.file_ref&.real_path&.to_s }
  end

  def script_phases
    pbx.build_phases.grep(Xcodeproj::Project::Object::PBXShellScriptBuildPhase)
  end

  def dependency_names
    pbx.dependencies.filter_map { |d| d.target&.name || d.name }
  end

  private

  def read_xcconfig(path)
    values = {}
    File.foreach(path) do |line|
      line = line.sub(%r{//.*}, '').strip
      if (m = line.match(/\A#include\??\s+"(.+)"/))
        values.merge!(read_xcconfig(File.expand_path(m[1], File.dirname(path))))
      elsif (m = line.match(/\A([A-Za-z0-9_]+(?:\[[^\]]+\])*)\s*=\s*(.*)\z/))
        values[m[1]] = m[2]
      end
    end
    values
  end

  def defaults(target_name, project_name)
    {
      'SRCROOT' => project_dir, 'PROJECT_DIR' => project_dir, 'SOURCE_ROOT' => project_dir,
      'PROJECT_NAME' => project_name, 'TARGET_NAME' => target_name, 'CONFIGURATION' => CONFIG,
      'PLATFORM_NAME' => 'iphoneos', 'EFFECTIVE_PLATFORM_NAME' => '-iphoneos', 'SDK_NAME' => 'iphoneos',
      'ARCHS' => TRIPLE_ARCH, 'CURRENT_ARCH' => TRIPLE_ARCH, 'NATIVE_ARCH' => TRIPLE_ARCH,
      'DEVELOPMENT_LANGUAGE' => 'en', 'ACTION' => 'build',
      'CONFIGURATION_BUILD_DIR' => '$(BUILD_DIR)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)',
      'BUILT_PRODUCTS_DIR' => '$(CONFIGURATION_BUILD_DIR)', 'TARGET_BUILD_DIR' => '$(CONFIGURATION_BUILD_DIR)',
      'PROJECT_TEMP_DIR' => '$(OBJROOT)/$(PROJECT_NAME).build',
      'CONFIGURATION_TEMP_DIR' => '$(PROJECT_TEMP_DIR)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)',
      'TARGET_TEMP_DIR' => '$(CONFIGURATION_TEMP_DIR)/$(TARGET_NAME).build',
      'DERIVED_FILE_DIR' => '$(TARGET_TEMP_DIR)/DerivedSources', 'DERIVED_SOURCES_DIR' => '$(DERIVED_FILE_DIR)',
      'OBJECT_FILE_DIR' => '$(TARGET_TEMP_DIR)/Objects',
      'PRODUCT_NAME' => '$(TARGET_NAME)', 'PRODUCT_MODULE_NAME' => '$(PRODUCT_NAME:c99extidentifier)',
      'EXECUTABLE_NAME' => '$(PRODUCT_NAME)', 'WRAPPER_EXTENSION' => 'bundle',
      'WRAPPER_NAME' => '$(PRODUCT_NAME).$(WRAPPER_EXTENSION)',
      'GCC_OPTIMIZATION_LEVEL' => 's', 'SWIFT_OPTIMIZATION_LEVEL' => '-O', 'SWIFT_VERSION' => '5.0',
      'GCC_C_LANGUAGE_STANDARD' => 'gnu11', 'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++20',
      'OTHER_CPLUSPLUSFLAGS' => '$(OTHER_CFLAGS)', 'USE_HEADERMAP' => 'YES',
      'IPHONEOS_DEPLOYMENT_TARGET' => '16.4', 'BUNDLE_FORMAT' => 'shallow',
      'CONTENTS_FOLDER_PATH' => '$(WRAPPER_NAME)', 'UNLOCALIZED_RESOURCES_FOLDER_PATH' => '$(CONTENTS_FOLDER_PATH)',
    }
  end

  def overrides
    {
      'SYMROOT' => File.join(OUT, 'Products'), 'BUILD_DIR' => File.join(OUT, 'Products'),
      'OBJROOT' => File.join(OUT, 'Intermediates'), 'SDKROOT' => TC.fetch('sdk'),
      'SDK_DIR' => TC.fetch('sdk'), 'NODE_BINARY' => TC.fetch('node'),
    }
  end
end

# Writes build.ninja.
class Generator
  def initialize
    @pods_project = Xcodeproj::Project.open(File.join(IOS, 'Pods/Pods.xcodeproj'))
    app_project_path = Dir[File.join(IOS, '*.xcodeproj')].first
    @app_project = Xcodeproj::Project.open(app_project_path)
    @pods = @pods_project.targets.to_h { |t| [t.name, Target.new(t, @pods_project, File.join(IOS, 'Pods'))] }
    @app = Target.new(@app_project.targets.find { |t| t.product_type == 'com.apple.product-type.application' },
                      @app_project, IOS)
    @lines = []
    @prepare_stamps = []
    @swift_outputs = {}
  end

  def run
    FileUtils.mkdir_p(OUT)
    rules
    build_set = release_closure
    # Bundles, then script phases, run as one sequential chain: phases of one
    # target must run in order (a configuration switch replaces the
    # xcframework a later phase copies), and EXConstants writes app.config
    # into its bundle directory.
    build_set.select(&:bundle?).each { |t| bundle(t) }
    build_set.each { |t| script_phases(t) }
    build_set.select(&:static_library?).each { |t| swift(t) }
    build_set.select(&:static_library?).each { |t| library(t, build_set) }
    app
    File.write(File.join(OUT, 'build.ninja'), @lines.join("\n") + "\n")
    File.write(File.join(OUT, 'app.json'), JSON.pretty_generate(app_summary))
  end

  private

  def q(path) = path.gsub(/([ :$])/, '$\1')

  def emit(line = '') = @lines << line

  def rules
    emit "ninja_required_version = 1.10\nbuilddir = #{q(File.join(OUT, '.ninja'))}"
    emit 'rule cc'
    emit "  command = #{TC.fetch('clang')} $flags -MMD -MF $out.d -c $in -o $out"
    emit '  depfile = $out.d'
    emit '  deps = gcc'
    emit '  description = CC $in'
    emit 'rule swiftc'
    emit "  command = #{TC.fetch('swiftc')} $flags $in"
    emit '  description = SWIFT $module'
    emit 'rule ar'
    emit "  command = rm -f $out && #{TC.fetch('ar')} rcs --format=darwin $out $in"
    emit '  description = AR $out'
    emit 'rule script'
    emit '  command = /bin/bash $script && touch $out'
    emit '  description = PHASE $label'
    emit 'rule bundle'
    emit '  command = /bin/bash $script && touch $out'
    emit '  description = BUNDLE $label'
  end

  # Release links exactly the libraries named in the app's Release settings
  # (Pods-<App>.release.xcconfig); their dependency closure brings in
  # aggregate targets (prebuilt frameworks, codegen). The Pods-<App> umbrella
  # target is left out: it only holds a dummy class, and its dependencies
  # include Debug-only pods (expo-dev-launcher, dev menu). Resource bundles
  # are the ones the Release resources script installs.
  def release_closure
    wanted = @app['OTHER_LDFLAGS'].scan(/-l"?([A-Za-z0-9_.+-]+)"?/).flatten.to_set
    roots = @pods.values.select { |t| t.static_library? && wanted.include?(t['PRODUCT_NAME']) }
    section = File.read(resources_script).split(/\nif \[\[ "\$CONFIGURATION" == "/).find { |s| s.start_with?(CONFIG) }
    bundle_names = section.to_s.scan(%r{/([^/"]+)\.bundle"}).flatten.to_set
    closure = {}
    queue = roots.dup
    until queue.empty?
      t = queue.shift
      next if closure.key?(t.name)

      closure[t.name] = t
      t.dependency_names.each { |d| queue << @pods.fetch(d) if @pods.key?(d) }
    end
    closure.values.reject { |t| t.bundle? && !bundle_names.include?(t['PRODUCT_NAME']) }
  end

  def resources_script
    Dir[File.join(IOS, 'Pods/Target Support Files/Pods-*/Pods-*-resources.sh')].first
  end

  def env_exports(t)
    t.settings.keys.sort.filter_map do |key|
      next if key.include?('[')

      "export #{key}=#{Shellwords.escape(t[key])}"
    end.join("\n")
  end

  # Xcode runs a phase with /bin/sh semantics (no -e/-u), every build setting
  # exported, and SCRIPT_INPUT_FILE_n / SCRIPT_OUTPUT_FILE_n for its declared
  # input and output paths.
  def phase_script(t, phase, index)
    dir = File.join(OUT, 'phases')
    FileUtils.mkdir_p(dir)
    path = File.join(dir, "#{t.name}-#{index}.sh")
    io = []
    { 'INPUT' => phase.input_paths, 'OUTPUT' => phase.output_paths }.each do |kind, paths|
      paths = (paths || []).map { |p| t.settings.expand(p) }
      io << "export SCRIPT_#{kind}_FILE_COUNT=#{paths.size}"
      paths.each_with_index do |p, i|
        io << "export SCRIPT_#{kind}_FILE_#{i}=#{Shellwords.escape(p)}"
        io << "mkdir -p #{Shellwords.escape(File.dirname(p))}" if kind == 'OUTPUT'
      end
    end
    File.write(path, <<~SH)
      #{env_exports(t)}
      #{io.join("\n")}
      export PATH=#{Shellwords.escape(File.join(__dir__, 'shims'))}:"$PATH"
      cd "$SRCROOT"
      #{phase.shell_script}
    SH
    path
  end

  def script_phases(t)
    t.script_phases.each_with_index do |phase, index|
      next if SKIPPED_PHASES.any? { |re| phase.name.to_s =~ re }
      next if phase.name.to_s == COMPAT_HEADER_PHASE

      stamp = File.join(OUT, 'stamps', "#{t.name}-#{index}.stamp")
      emit "build #{q(stamp)}: script#{chain_after}"
      emit "  script = #{q(phase_script(t, phase, index))}"
      emit "  label = #{t.name}: #{phase.name.to_s.gsub(/[$\n]/, ' ')}"
      @prepare_stamps << stamp
    end
  end

  def chain_after
    @prepare_stamps.empty? ? '' : " || #{q(@prepare_stamps.last)}"
  end

  def header_dirs(t)
    (t.headers + t.sources.map(&:first)).map { |f| File.dirname(f) }.uniq
  end

  def search_flags(t)
    flags = []
    flags += t.list('FRAMEWORK_SEARCH_PATHS').flat_map { |p| expand_recursive(p).map { |d| "-F#{d}" } }
    flags << "-F#{t['BUILT_PRODUCTS_DIR']}"
    flags += t.list('SYSTEM_HEADER_SEARCH_PATHS').flat_map { |p| expand_recursive(p).flat_map { |d| ['-isystem', d] } }
    flags += t.list('HEADER_SEARCH_PATHS').flat_map { |p| expand_recursive(p).map { |d| "-I#{d}" } }
    flags += t.list('USER_HEADER_SEARCH_PATHS').flat_map { |p| expand_recursive(p).flat_map { |d| ['-iquote', d] } }
    # Stand-in for Xcode's own-target header map: quoted includes resolve
    # against every directory holding one of the target's headers or sources.
    flags += header_dirs(t).flat_map { |d| ['-iquote', d] } if t.yes?('USE_HEADERMAP')
    flags += ["-I#{t['BUILT_PRODUCTS_DIR']}/include", "-I#{t['DERIVED_FILE_DIR']}", "-I#{t['DERIVED_FILE_DIR']}/#{TRIPLE_ARCH}"]
    flags
  end

  def expand_recursive(path)
    return [path] unless path.end_with?('/**')

    root = path.delete_suffix('/**')
    return [] unless File.directory?(root)

    [root] + Dir.glob(File.join(root, '**/*/')).map { |d| d.chomp('/') }
  end

  def defines(t)
    t.list('GCC_PREPROCESSOR_DEFINITIONS').map { |d| "-D#{d}" }
  end

  def clang_flags(t, file, per_file)
    ext = File.extname(file)
    objc = %w[.m .mm].include?(ext)
    cxx = %w[.mm .cpp .cc .cxx].include?(ext)
    lang = { '.m' => 'objective-c', '.mm' => 'objective-c++', '.c' => 'c', '.cpp' => 'c++', '.cc' => 'c++', '.cxx' => 'c++' }.fetch(ext)
    flags = ['-x', lang, '-target', "arm64-apple-ios#{t['IPHONEOS_DEPLOYMENT_TARGET']}", '-isysroot', TC.fetch('sdk'),
             "-O#{t['GCC_OPTIMIZATION_LEVEL']}", '-fmessage-length=0', '-fno-common', '-w', '-g0']
    flags << (cxx ? "-std=#{t['CLANG_CXX_LANGUAGE_STANDARD']}" : "-std=#{t['GCC_C_LANGUAGE_STANDARD']}")
    flags << "-stdlib=#{t['CLANG_CXX_LIBRARY']}" if cxx
    flags << '-fobjc-arc' if objc && t.yes?('CLANG_ENABLE_OBJC_ARC')
    flags << '-fobjc-weak' if objc && t.yes?('CLANG_ENABLE_OBJC_WEAK')
    if t.yes?('CLANG_ENABLE_MODULES') && lang != 'c++'
      flags += ['-fmodules', "-fmodules-cache-path=#{File.join(OUT, 'ModuleCache')}"]
      flags << '-fcxx-modules' if lang == 'objective-c++'
    end
    flags << "-fmodule-name=#{t['PRODUCT_MODULE_NAME']}" if t.yes?('DEFINES_MODULE')
    pch = t['GCC_PREFIX_HEADER']
    flags += ['-include', File.expand_path(pch, t['SRCROOT'])] unless pch.empty?
    flags += defines(t)
    flags += search_flags(t)
    flags += t.list(cxx ? 'OTHER_CPLUSPLUSFLAGS' : 'OTHER_CFLAGS')
    flags += t.split(per_file) unless per_file.empty?
    flags
  end

  def swift_sources(t) = t.sources.select { |f, _| f.end_with?('.swift') }

  def swift_module_dir(t) = File.join(t['BUILT_PRODUCTS_DIR'], "#{t['PRODUCT_MODULE_NAME']}.swiftmodule")

  def swift_flags(t)
    flags = ['-target', "arm64-apple-ios#{t['IPHONEOS_DEPLOYMENT_TARGET']}", '-sdk', TC.fetch('sdk'),
             '-module-name', t['PRODUCT_MODULE_NAME'], '-swift-version', swift_version(t),
             t['SWIFT_OPTIMIZATION_LEVEL'], '-whole-module-optimization', '-num-threads', '0',
             '-module-cache-path', File.join(OUT, 'ModuleCache'), '-Xcc', '-w', '-suppress-warnings']
    flags += t.list('SWIFT_INCLUDE_PATHS').flat_map { |p| ['-I', p] }
    flags += ['-I', t['BUILT_PRODUCTS_DIR']]
    flags += t.list('FRAMEWORK_SEARCH_PATHS').flat_map { |p| expand_recursive(p).flat_map { |d| ['-F', d] } }
    flags += ['-F', t['BUILT_PRODUCTS_DIR']]
    flags += defines(t).flat_map { |d| ['-Xcc', d] }
    flags += t.list('HEADER_SEARCH_PATHS').flat_map { |p| expand_recursive(p).flat_map { |d| ['-Xcc', "-I#{d}"] } }
    flags += header_dirs(t).flat_map { |d| ['-Xcc', '-iquote', '-Xcc', d] }
    flags += t.list('SWIFT_ACTIVE_COMPILATION_CONDITIONS').flat_map { |c| ['-D', c] }
    flags += macro_plugin_rewrite(t.list('OTHER_SWIFT_FLAGS'))
    bridging = t['SWIFT_OBJC_BRIDGING_HEADER']
    flags += ['-import-objc-header', File.expand_path(bridging, t['SRCROOT'])] unless bridging.empty?
    flags
  end

  # Swift 5.0 is gone from Swift 6 compilers; Xcode maps it to 5.
  def swift_version(t)
    v = t['SWIFT_VERSION']
    v.start_with?('5') ? '5' : v.split('.').first
  end

  def macro_plugin_rewrite(flags)
    flags.map do |f|
      f.include?('ExpoModulesMacros-tool#') ? "#{TC.fetch('macro_plugin')}#ExpoModulesMacros" : f
    end
  end

  def swift(t)
    sources = swift_sources(t).map(&:first)
    return if sources.empty?

    mod = t['PRODUCT_MODULE_NAME']
    obj = File.join(t['OBJECT_FILE_DIR'], "#{mod}-swift.o")
    swiftmodule = File.join(swift_module_dir(t), 'arm64-apple-ios.swiftmodule')
    header = File.join(t['DERIVED_SOURCES_DIR'], "#{mod}-Swift.h")
    flags = swift_flags(t) + ['-parse-as-library', '-emit-module', '-emit-module-path', swiftmodule,
                              '-emit-objc-header', '-emit-objc-header-path', header, '-c', '-o', obj]
    deps = t.dependency_names.filter_map { |d| @swift_outputs[d] }.flatten
    FileUtils.mkdir_p([File.dirname(obj), swift_module_dir(t), File.dirname(header)])
    emit "build #{q(obj)} #{q(swiftmodule)} #{q(header)}: swiftc #{sources.map { |s| q(s) }.join(' ')} | #{deps.map { |d| q(d) }.join(' ')} || #{@prepare_stamps.map { |s| q(s) }.join(' ')}"
    emit "  flags = #{flags.map { |f| ninja_arg(f) }.join(' ')}"
    emit "  module = #{mod}"
    compat = compat_header(t, header)
    @swift_outputs[t.name] = [swiftmodule, compat]
  end

  def compat_header(t, header)
    phase_index = t.script_phases.index { |p| p.name.to_s == COMPAT_HEADER_PHASE }
    return header unless phase_index

    stamp = File.join(OUT, 'stamps', "#{t.name}-compat.stamp")
    emit "build #{q(stamp)}: script #{q(header)}"
    emit "  script = #{q(phase_script(t, t.script_phases[phase_index], phase_index))}"
    emit "  label = #{t.name}: compatibility header"
    stamp
  end

  def ninja_arg(arg)
    q(Shellwords.escape(arg))
  end

  def all_dependency_names(t, seen = Set.new)
    t.dependency_names.each do |d|
      next if seen.include?(d) || !@pods.key?(d)

      seen << d
      all_dependency_names(@pods[d], seen)
    end
    seen
  end

  def library(t, build_set)
    objects = []
    swift_obj = File.join(t['OBJECT_FILE_DIR'], "#{t['PRODUCT_MODULE_NAME']}-swift.o")
    objects << swift_obj if @swift_outputs.key?(t.name)
    order_only = @prepare_stamps.dup
    order_only += all_dependency_names(t).flat_map { |d| @swift_outputs[d] || [] }
    order_only += @swift_outputs[t.name] || []
    t.sources.each do |file, per_file|
      next if file.end_with?('.swift')

      obj = File.join(t['OBJECT_FILE_DIR'], "#{File.basename(file, '.*')}-#{file.hash.abs.to_s(36)}.o")
      emit "build #{q(obj)}: cc #{q(file)} || #{order_only.map { |s| q(s) }.join(' ')}"
      emit "  flags = #{clang_flags(t, file, per_file).map { |f| ninja_arg(f) }.join(' ')}"
      objects << obj
    end
    lib = File.join(t['BUILT_PRODUCTS_DIR'], "lib#{t['PRODUCT_NAME']}.a")
    emit "build #{q(lib)}: ar #{objects.map { |o| q(o) }.join(' ')}"
    (@libraries ||= []) << lib
  end

  def bundle(t)
    dir = File.join(t['CONFIGURATION_BUILD_DIR'], t['WRAPPER_NAME'])
    plist = File.expand_path(t['INFOPLIST_FILE'], t['SRCROOT'])
    script = File.join(OUT, 'phases', "#{t.name}-bundle.sh")
    FileUtils.mkdir_p(File.dirname(script))
    copies = t.resources.map { |r| "cp -R #{Shellwords.escape(r)} #{Shellwords.escape(dir)}/" }
    File.write(script, <<~SH)
      set -euo pipefail
      #{env_exports(t)}
      mkdir -p #{Shellwords.escape(dir)}
      #{copies.join("\n")}
      python3 #{Shellwords.escape(File.join(__dir__, 'expand-plist.py'))} #{Shellwords.escape(plist)} #{Shellwords.escape(File.join(dir, 'Info.plist'))}
    SH
    stamp = File.join(OUT, 'stamps', "#{t.name}-bundle.stamp")
    emit "build #{q(stamp)}: bundle#{chain_after}"
    emit "  script = #{q(script)}"
    emit "  label = #{t['WRAPPER_NAME']}"
    (@bundles ||= []) << [stamp, dir]
    @prepare_stamps << stamp
  end

  # The app executable: its Swift sources (AppDelegate + generated
  # ExpoModulesProvider) compiled against every pod module, then linked.
  def app
    t = @app
    sources = swift_sources(t).map(&:first)
    obj = File.join(t['OBJECT_FILE_DIR'], "#{t['PRODUCT_MODULE_NAME']}-swift.o")
    FileUtils.mkdir_p(File.dirname(obj))
    pod_swift = @swift_outputs.values.flatten
    flags = swift_flags(t) + ['-parse-as-library', '-c', '-o', obj]
    emit "build #{q(obj)}: swiftc #{sources.map { |s| q(s) }.join(' ')} | #{pod_swift.map { |d| q(d) }.join(' ')} || #{@prepare_stamps.map { |s| q(s) }.join(' ')}"
    emit "  flags = #{flags.map { |f| ninja_arg(f) }.join(' ')}"
    emit "  module = #{t['PRODUCT_MODULE_NAME']}"
    exe = File.join(OUT, 'app', t['EXECUTABLE_NAME'])
    link_flags = ['-target', "arm64-apple-ios#{t['IPHONEOS_DEPLOYMENT_TARGET']}", '-sdk', TC.fetch('sdk'),
                  '-emit-executable', "-ld-path=#{TC.fetch('ld')}", '-o', exe]
    link_flags += t.list('LIBRARY_SEARCH_PATHS').flat_map { |p| ['-L', p] }
    link_flags += t.list('FRAMEWORK_SEARCH_PATHS').flat_map { |p| expand_recursive(p).flat_map { |d| ['-F', d] } }
    link_flags += ldflags(t.list('OTHER_LDFLAGS'))
    link_flags += t.list('LD_RUNPATH_SEARCH_PATHS').flat_map { |p| ['-Xlinker', '-rpath', '-Xlinker', p] }
    link_flags += ['-Xlinker', '-dead_strip']
    emit 'rule link'
    emit "  command = #{TC.fetch('swiftc')} $flags $in"
    emit '  description = LINK $out'
    emit "build #{q(exe)}: link #{q(obj)} | #{(@libraries || []).map { |l| q(l) }.join(' ')}"
    emit "  flags = #{link_flags.map { |f| ninja_arg(f) }.join(' ')}"
    emit "build app: phony #{q(exe)} #{(@bundles || []).map { |s, _| q(s) }.join(' ')}"
    emit 'default app'
    @exe = exe
  end

  # OTHER_LDFLAGS is written for clang; the swiftc link driver needs linker-only
  # flags wrapped in -Xlinker.
  def ldflags(flags)
    out = []
    iter = flags.each
    loop do
      f = iter.next
      case f
      when '-framework', '-weak_framework'
        name = iter.next
        out += f == '-framework' ? ['-framework', name] : ['-Xlinker', '-weak_framework', '-Xlinker', name]
      when /\A-l/ then out << f
      when '-ObjC', '-all_load' then out += ['-Xlinker', f]
      else out += ['-Xlinker', f]
      end
    end
    out
  end

  def app_summary
    t = @app
    {
      executable: @exe,
      product_name: t['PRODUCT_NAME'],
      bundle_id: t['PRODUCT_BUNDLE_IDENTIFIER'],
      info_plist: File.expand_path(t['INFOPLIST_FILE'], t['SRCROOT']),
      entitlements: File.expand_path(t['CODE_SIGN_ENTITLEMENTS'], t['SRCROOT']),
      marketing_version: t['MARKETING_VERSION'],
      build_number: t['CURRENT_PROJECT_VERSION'],
      deployment_target: t['IPHONEOS_DEPLOYMENT_TARGET'],
      resources: t.resources,
      bundles: (@bundles || []).map(&:last),
      frameworks_script: Dir[File.join(IOS, 'Pods/Target Support Files/Pods-*/Pods-*-frameworks.sh')].first,
      settings_env: File.join(OUT, 'app-env.sh'),
    }.tap { File.write(File.join(OUT, 'app-env.sh'), env_exports(t) + "\n") }
  end
end

Generator.new.run
