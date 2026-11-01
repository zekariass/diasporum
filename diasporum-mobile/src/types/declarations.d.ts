/**
 * Ambient type declarations for non-TypeScript assets.
 */

/** CSS Modules (used by web-specific components and global.css). */
declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}
