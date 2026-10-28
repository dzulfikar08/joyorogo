// The native iOS tab bar cannot swallow a tab press, so the camera item does select this tab. The layout's focus
// listener sends the user back to the previous tab and opens the scanner; the screen itself stays empty.
export default function KameraPlaceholder() {
  return null;
}
