export declare const SCRYPT_PARAMS: { N: number; r: number; p: number };
export declare const KEYLEN: number;
export declare const SCHEME: string;
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, stored: string | undefined): Promise<boolean>;
export declare function normalizeStored(stored: string | undefined): string;
export declare function storedStatus(stored: string | undefined): "ok" | "missing" | "malformed";
