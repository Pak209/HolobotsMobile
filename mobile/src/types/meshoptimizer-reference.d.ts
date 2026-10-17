declare module 'meshoptimizer/meshopt_decoder_reference.js' {
  export const MeshoptDecoder: {
    supported: boolean;
    ready: Promise<void>;
    decodeVertexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, filter?: string): void;
    decodeIndexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
    decodeIndexSequence(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
    decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
  };
}
declare module 'fast-text-encoding';
