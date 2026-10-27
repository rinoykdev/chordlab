export * from './types';
export { analyzeAudio, decodeFeatures, ENGINE_VERSION } from './analyze';
export { extractFeatures, ANALYSIS_RATE } from './features';
export { buildVocabulary } from './vocabulary';
export { templateRecognizer } from './recognizers/template';
export type { ChordRecognizer } from './recognizers/types';
export * from './learn';
export { createTemplateRecognizer } from './recognizers/template';
