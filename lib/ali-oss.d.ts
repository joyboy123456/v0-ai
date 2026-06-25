declare module 'ali-oss' {
  class OSS {
    constructor(options: any);
    put(name: string, file: any, options?: any): Promise<any>;
    get(name: string, file?: any, options?: any): Promise<any>;
    delete(name: string, options?: any): Promise<any>;
    list(query: {
      prefix?: string;
      'max-keys'?: number;
      'continuation-token'?: string;
      [key: string]: any;
    }, options?: any): Promise<{
      objects?: Array<{ name: string; size: number; lastModified: string }>;
      nextContinuationToken?: string;
      [key: string]: any;
    }>;
    deleteMulti(keys: string[], options?: any): Promise<{
      deleted?: Array<{ name: string }>;
      [key: string]: any;
    }>;
  }
  export default OSS;
}
