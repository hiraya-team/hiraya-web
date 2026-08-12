import type { CSSBeautifyOptions, HTMLBeautifyOptions, JSBeautifyOptions } from "js-beautify";

declare global {
  var beautifier: {
    css(source: string, options?: CSSBeautifyOptions): string;
    html(source: string, options?: HTMLBeautifyOptions): string;
    js(source: string, options?: JSBeautifyOptions): string;
  };
}

export {};
