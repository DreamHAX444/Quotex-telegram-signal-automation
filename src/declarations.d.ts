declare module 'input' {
  export function text(message: string, options?: { default?: string }): Promise<string>;
  export function password(message: string, options?: { default?: string }): Promise<string>;
  export function confirm(message: string, options?: { default?: boolean }): Promise<boolean>;
  export function select(message: string, choices: string[]): Promise<string>;
}
