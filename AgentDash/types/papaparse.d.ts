declare module "papaparse" {
  export type ParseConfig = {
    header?: boolean;
    skipEmptyLines?: boolean;
    [key: string]: unknown;
  };

  export type ParseResult<T> = {
    data: T[];
    errors: unknown[];
    meta?: unknown;
  };

  export function parse<T = any>(input: string, config?: ParseConfig): ParseResult<T>;

  const Papa: {
    parse: typeof parse;
  };

  export default Papa;
}

