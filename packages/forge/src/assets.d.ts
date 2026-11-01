// Vite asset imports used by tests: `?inline` turns a committed file into a base64 `data:` URL,
// so a test can read real image bytes without Node's fs (the package has no Node types).
declare module "*.png?inline" {
  const dataUrl: string;
  export default dataUrl;
}
