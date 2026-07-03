// Bounded quantifiers keep the regex linear (sonarjs/super-linear-regex);
// no real tool ships a version component longer than 4 digits.
export const extractSemver = (text: string): string | undefined => /(\d{1,4}\.\d{1,4}\.\d{1,4})/.exec(text)?.[1];

export const gteSemver = (version: string, minimum: string): boolean => {
  const [actual, wanted] = [version, minimum].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== wanted[i]) return actual[i] > wanted[i];
  }
  return true;
};
