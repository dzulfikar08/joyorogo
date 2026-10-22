// Bone-in meat is weighed with the bone on the plate but eaten without it. These are the edible shares of the weight as
// seen for fried or grilled pieces, by part. They are ESTIMATES (a cut, a cook and a plate differ by +-10 points) taken from
// the usual poultry, rib and whole-fish yields; the scan always labels them "perkiraan".
//
// A name that says the meat is already off the bone, or a dish that is more than the meat (soup, rice plate, sandwich), is
// not bone-in: the weight there is not the meat on a bone.

/** Meat already off the bone, or a dish that holds more than the piece: the whole weight is eaten. */
const NOT_ON_THE_BONE =
  /\b(fillet|filet|suwir|tanpa tulang|boneless|tulang lunak|presto|katsu|nasi|mie|mi|bihun|kwetiau|soto|sop|sup|gulai|konro|rawon|bakso|sate|opor|kari|soup|rice|noodle|burger|sandwich|pizza)\b/;

const CHICKEN = /\b(ayam|chicken)\b/;

type Rule = { name: RegExp; needs?: RegExp; fraction: number };

/** First matching rule wins: the narrower part before the wider one. */
const RULES: readonly Rule[] = [
  { name: /\b(sayap|wings?|drumettes?)\b/, needs: CHICKEN, fraction: 0.5 },
  { name: /\b(paha bawah|drumsticks?)\b/, fraction: 0.6 },
  { name: /\b(paha atas|thighs?)\b/, needs: CHICKEN, fraction: 0.7 },
  { name: /\bpaha\b/, needs: CHICKEN, fraction: 0.65 },
  { name: /\b(dada|breast)\b/, needs: CHICKEN, fraction: 0.7 },
  { name: /\b(iga|ribs?|spare ?ribs?)\b/, fraction: 0.5 },
  {
    name: /\b(lele|nila|gurame|gurami|mujair|bandeng|kembung|bawal|ikan mas|kakap|ikan utuh|whole fish)\b/,
    fraction: 0.55,
  },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The edible share of the weight as seen for a named bone-in part, or undefined when the name is no bone-in part. */
export function boneInFraction(name: string): number | undefined {
  const key = normalize(name);
  if (NOT_ON_THE_BONE.test(key)) return undefined;
  const rule = RULES.find((r) => r.name.test(key) && (r.needs === undefined || r.needs.test(key)));
  return rule?.fraction;
}
