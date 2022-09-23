
export type ValidFeatures = 'api' | 'css' | 'html' | 'javascript';
export type FeatureConfig = { [K in ValidFeatures]: { name: string } }