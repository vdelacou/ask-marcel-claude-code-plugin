export type FileProbe = {
  readonly exists: (path: string) => Promise<boolean>;
};
