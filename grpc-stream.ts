import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import dotenv from 'dotenv';

dotenv.config();

const PROTO_PATH = '/geyser.proto';

interface SlotNotification {
    slot: number;
    parent: number;
    status: string;
}

export class ShredSentryStream {
    private rpcUrl: string;

    constructor() {
        this.rpcUrl = process.env.SOLINFRA_gRPC_URL || 'localhost:10000';
    }

    public async connectToGeyser(onSlotReceived: (slotData: SlotNotification) => void) {
        console.log(`[gRPC] 📡 Connecting to Yellowstone stream...`);
        
        try {
            // 1. Dynamically load the Protobuf schemas we just downloaded
            const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
                includeDirs: ['./proto'] // Tells geyser.proto where to find solana-storage.proto
            });
            
            const geyserProto = grpc.loadPackageDefinition(packageDefinition).geyser as any;
            
            // 2. Parse the SolInfra URL securely
            let host = this.rpcUrl;
            let token = '';
            
            if (this.rpcUrl.startsWith('http')) {
                const urlObj = new URL(this.rpcUrl);
                host = `${urlObj.hostname}:443`;
                token = urlObj.searchParams.get('api_key') || '';
            }

            // 3. Establish TLS Encryption
            const credentials = grpc.credentials.createSsl();
            const client = new geyserProto.Geyser(host, credentials);

            // 4. Inject the SolInfra API Key into the Headers
            const metadata = new grpc.Metadata();
            if (token) {
                metadata.add('x-token', token);
            }

            // 5. Open the Stream
            const stream = client.Subscribe(metadata);
            
            stream.write({
                slots: { subscribeToSlots: {} },
                commitment: 1 // 1 = PROCESSED commitment level
            });

            stream.on('data', (data: any) => {
                if (data.slot) {
                    onSlotReceived({
                        slot: Number(data.slot.slot),
                        parent: Number(data.slot.parent),
                        status: 'PROCESSED'
                    });
                }
            });

            stream.on('error', (err: any) => {
                // Ignore silent HTTP/2 disconnections which are normal in long-polling
                if (err.code !== grpc.status.CANCELLED) {
                    console.error(`[gRPC_ERROR] ⚠️ Stream error:`, err.message);
                }
            });

        } catch (error) {
            console.error(`[gRPC_CRITICAL] Failed to initialize proto channels:`, error);
        }
    }
}