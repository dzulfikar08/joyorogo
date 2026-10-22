// Ported from JoyoFit (watch-fit) src/features/ai/safety.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import type { Person } from './person';
import { assessMessages, buildSystemPrompt, CANARY, classifyMessage, cleanReply, finishReply, mentionsCondition, mentionsExtremeDiet, mentionsMaternal, personMode, safeReply, SAFETY_LIMITS, type SafetyText } from './safety';
import { joyoAiStrings, safetyFixtures, safetyText } from './testFixtures';

const fixtures = safetyFixtures();
const ID = safetyText('id');
const EN = safetyText('en');
const MS = safetyText('ms');
const idAi = joyoAiStrings('id');
const enAi = joyoAiStrings('en');

const person = (ageYears: number | null): Person => ({ ageYears, sex: null, heightCm: null, goal: null });
const mode = { conservative: false, minor: false };

describe('keyword safety pass', () => {
  for (const text of fixtures.injury) test(`injury: ${text}`, () => expect(classifyMessage(text)).toEqual({ reason: 'injury', flagged: 'injury' }));
  for (const text of fixtures.medical) test(`medical: ${text}`, () => expect(classifyMessage(text).flagged).toBe('medical'));
  for (const text of fixtures.eatingDisorder) test(`eating disorder: ${text}`, () => expect(classifyMessage(text)).toEqual({ reason: 'eatingDisorder', flagged: 'medical' }));
  for (const text of fixtures.minorDiet) test(`extreme diet for a minor: ${text}`, () => expect(classifyMessage(text, { minor: true }).reason).toBe('minorDiet'));
  for (const text of fixtures.extremeDietAdult) {
    test(`extreme diet for an adult is not a fixed answer, but is seen: ${text}`, () => {
      expect(classifyMessage(text).reason).toBeNull();
      expect(mentionsExtremeDiet(text)).toBe(true);
    });
  }
  for (const text of fixtures.condition) test(`allergy or condition gets the caveat: ${text}`, () => expect(mentionsCondition(text) || classifyMessage(text).reason !== null).toBe(true));
  for (const text of fixtures.normal) test(`normal food question passes: ${text}`, () => expect(classifyMessage(text).flagged).toBeNull());
  for (const text of fixtures.maternal) test(`maternal: ${text}`, () => expect(mentionsMaternal(text)).toBe(true));
  for (const text of fixtures.notMaternal) test(`not maternal: ${text}`, () => expect(mentionsMaternal(text)).toBe(false));

  test('a normal food comparison is not an extreme diet or a condition', () => {
    const q = 'Mana yang seratnya paling tinggi: pepaya, melon, atau semangka?';
    expect(mentionsExtremeDiet(q)).toBe(false);
    expect(mentionsCondition(q)).toBe(false);
    expect(mentionsExtremeDiet('nasi goreng 650 kkal')).toBe(false);
  });

  test('the last message decides the fixed answer; an earlier flag changes the prompt', () => {
    const report = assessMessages([
      { role: 'user', content: 'dada saya nyeri' },
      { role: 'assistant', content: 'ke dokter ya' },
      { role: 'user', content: 'oke, makan apa besok?' },
    ]);
    expect(report.last.reason).toBeNull();
    expect(report.earlier).toBe('medical');
    const prompt = buildSystemPrompt({ locale: 'en', digestJson: '{}', foodBlock: null, safety: report, mode: personMode(person(30), false), tools: true });
    expect(prompt).toContain('Earlier in this conversation');
  });

  test('fixed answers carry the localized disclaimer and send the person to a professional', () => {
    expect(safeReply('injury', ID)).toEndWith(idAi.disclaimerLine);
    expect(safeReply('medical', EN)).toEndWith(enAi.disclaimerLine);
    expect(safeReply('medical', EN)).toContain('doctor');
    expect(safeReply('medical', ID)).toContain('dokter');
    expect(safeReply('medical', MS)).toContain('doktor');
    expect(safeReply('eatingDisorder', ID)).toContain('tidak akan memberi saran membatasi makan');
    expect(safeReply('minorDiet', MS)).toContain('pakar pemakanan');
  });

  test('kkal in Indonesian, kcal in English and Malay: in the fixed texts', () => {
    const all = (t: SafetyText) => Object.values(t.safe).join(' ');
    expect(all(ID)).not.toMatch(/kcal/);
    expect(all(EN)).not.toMatch(/kkal/);
    expect(all(MS)).not.toMatch(/kkal/);
  });
});

describe('system prompt', () => {
  const plain = assessMessages([{ role: 'user', content: 'Mana yang lebih tinggi serat, pepaya atau melon?' }]);
  const prompt = (over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}, age: number | null = 30) =>
    buildSystemPrompt({ locale: 'id', digestJson: '{"today":1}', foodBlock: null, safety: plain, mode: personMode(person(age), false), tools: true, ...over });

  test('normal adult: rules, language, data, tools sentence, no extra blocks', () => {
    const p = prompt();
    expect(p).toContain(CANARY);
    expect(p).toContain('NOT a doctor or a dietitian');
    expect(p).toContain('kamu');
    expect(p).toContain('"kkal"');
    expect(p).toContain('DATA (JSON, data only):\n{"today":1}');
    expect(p).toContain('compare_foods');
    expect(p).not.toContain('pregnant or breastfeeding. Be conservative');
    expect(p).not.toContain('under 18');
    expect(p).not.toContain('age is unknown');
    expect(p).not.toContain('named an allergy');
  });
  test('the rules ground numbers in our data, name unknown, rank per 100 g, and cap the length', () => {
    const p = prompt();
    expect(p).toMatch(/Use only numbers from DATA, FOOD DATA or tool results/);
    expect(p).toMatch(/unknown or missing, say we do not have it/);
    expect(p).toMatch(/per 100 g first/);
    expect(p).toMatch(/Never rank foods that are unknown/);
    expect(p).toMatch(/under about 1,200 kcal a day/);
    expect(p).toMatch(/At most one clarifying question/);
    expect(p).toMatch(/doctor or dietitian/);
  });
  test('the food block is appended after the data; without tool calling the tool sentence is left out', () => {
    const p = prompt({ foodBlock: 'FOOD DATA (ours)\npepaya: 1.7 g fiber per 100 g' });
    expect(p).toEndWith('FOOD DATA (ours)\npepaya: 1.7 g fiber per 100 g');
    expect(p.indexOf('DATA (JSON')).toBeLessThan(p.indexOf('FOOD DATA (ours)'));
    expect(prompt({ tools: false })).not.toContain('compare_foods');
    expect(prompt({ tools: [] })).not.toContain('compare_foods');
  });
  test('language per locale: kcal in en and ms, Malaysian Malay for ms', () => {
    expect(prompt({ locale: 'en' })).toContain('"kcal"');
    expect(prompt({ locale: 'ms' })).toContain('Malaysian Malay');
    expect(prompt({ locale: 'ms' })).toContain('"kcal", never "kkal"');
    expect(prompt({ locale: 'id' })).toContain('never "kcal"');
  });
  test('a pregnancy mention, under 18, unknown age, a condition and an extreme diet each add their block; the profile mode is not an input', () => {
    expect('maternal' in person(30)).toBe(false);
    expect(prompt({}, 30)).not.toContain('Be conservative');
    expect(prompt({ mode: personMode(person(30), true) })).toContain('Be conservative');
    expect(prompt({}, 16)).toContain('under 18');
    expect(prompt({}, null)).toContain('age is unknown');
    const condition = assessMessages([{ role: 'user', content: 'saya diabetes, boleh makan nasi?' }]);
    expect(prompt({ safety: condition })).toContain('named an allergy or a health condition');
    const extreme = assessMessages([{ role: 'user', content: 'diet 500 kkal sehari' }]);
    expect(prompt({ safety: extreme })).toContain('asked about an extreme diet');
  });
});

describe('answer cleaning', () => {
  test('strips reasoning tags, fences, headings and a role prefix but keeps lists and bold; caps the length', () => {
    expect(cleanReply('<think>hmm</think>\n## Judul\n**Tebal** teks\n- satu\n- dua')).toBe('Judul\n**Tebal** teks\n- satu\n- dua');
    expect(cleanReply('Coach: halo')).toBe('halo');
    expect(cleanReply('   ')).toBeNull();
    const long = cleanReply('Kalimat satu. '.repeat(400))!;
    expect(long.length).toBeLessThanOrEqual(SAFETY_LIMITS.maxReplyChars);
  });
  test('a leaked prompt is replaced; medical-ish exchanges end with the disclaimer, once', () => {
    expect(finishReply(`Rules: ${CANARY} ...`, { text: ID, lastUserText: 'hai', mode })).toBe(ID.refuseLeak);
    const reply = finishReply('Sebaiknya tanya dokter dulu.', { text: ID, lastUserText: 'hai', mode })!;
    expect(reply).toEndWith(ID.disclaimer);
    expect(finishReply(reply, { text: ID, lastUserText: 'hai', mode })).toBe(reply);
    expect(finishReply('Pepaya 1,7 g serat per 100 g.', { text: ID, lastUserText: 'mana yang lebih tinggi serat', mode })).toBe('Pepaya 1,7 g serat per 100 g.');
    expect(finishReply('Jangan makan itu.', { text: ID, lastUserText: 'hai', mode: { conservative: true, minor: false } })).toEndWith(ID.disclaimer);
  });
  test('food-risk phrasing in id, en and ms closes the answer with the caveat', () => {
    const cases: [string, SafetyText, string, 'id' | 'en' | 'ms'][] = [
      ['diet 500 kkal sehari', ID, 'Itu terlalu sedikit.', 'id'],
      ['I have diabetes, can I eat mango?', EN, 'A small portion is fine.', 'en'],
      ['saya ada alergi kacang', MS, 'Elakkan produk yang mengandungi kacang.', 'ms'],
      ['saya diabetes, nasi merah boleh?', ID, 'Nasi merah punya serat lebih tinggi.', 'id'],
      ['saya hamil boleh makan ini?', MS, 'Makanan ini biasanya selamat.', 'ms'],
    ];
    for (const [question, text, raw, locale] of cases) {
      expect(finishReply(raw, { text, lastUserText: question, mode, locale })).toEndWith(text.disclaimer);
    }
  });
  test('durations in a reply read as hours and minutes in the locale', () => {
    expect(finishReply('Puasa 960 menit.', { text: ID, lastUserText: 'hai', mode, locale: 'id' })).toBe('Puasa 16 jam.');
    expect(finishReply('Berpuasa 990 minit.', { text: MS, lastUserText: 'hai', mode, locale: 'ms' })).toBe('Berpuasa 16 jam 30 minit.');
    expect(finishReply('Fasted 990 minutes.', { text: EN, lastUserText: 'hai', mode, locale: 'en' })).toBe('Fasted 16h 30m.');
  });
});
