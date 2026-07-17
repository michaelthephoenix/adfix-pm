export type StoredObject = {
  objectKey: string;
  checksumSha256: string;
  size: number;
};

export interface StorageProvider {
  save(input: { buffer: Buffer; fileName: string }): Promise<StoredObject>;
  resolve(objectKey: string): Promise<string>;
  delete(objectKey: string): Promise<void>;
}
