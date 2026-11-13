// occt-import-js ships no type declarations; src/engine/step-import.ts types the parts it uses.
declare module 'occt-import-js' {
  const factory: (opts?: { locateFile?: () => string }) => Promise<unknown>;
  export default factory;
}
