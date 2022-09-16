import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    KMSClient,
    CreateKeyCommand,
    CreateKeyCommandInput,
    KeyUsageType,
    KeySpec,
    CreateGrantCommand,
    CreateGrantCommandInput,
    GrantOperation,
    GetPublicKeyCommand,
} from '@aws-sdk/client-kms';
import * as jose from 'jose';
import { GetObjectCommand, GetObjectCommandInput, PutObjectCommand, PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand, CreateInvalidationCommandInput } from '@aws-sdk/client-cloudfront';

export type RotateKeyRequest = {
    keyAlias: string;
    canSignRoleArn: string;
    keyManagementRoleArn: string;
    publicKeysBucketName: string;
    cloudfrontDistributionId: string;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    return await runCreateUploadKey(event);
};

export async function runCreateUploadKey(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const request: RotateKeyRequest = JSON.parse(_event.body ?? '') as RotateKeyRequest;

    // 1. Create KMS Key and relevant permissions
    const kmsClient = new KMSClient({});
    const newKey = await createNewKmsKey(kmsClient, request);

    // 2. Get New KMS Public Key obj
    const publicKeyResponse = await kmsClient.send(new GetPublicKeyCommand({ KeyId: newKey.KeyMetadata?.KeyId }));
    const publicKeyAsSpki = Buffer.from(publicKeyResponse.PublicKey!).toString('utf-8');

    // 3. Convert to JWKS entry
    const joseKey = await jose.importSPKI(publicKeyAsSpki, 'ES256');
    const minJwkEntry = await jose.exportJWK(joseKey);
    const fullJwkEntry: jose.JWK = { kid: newKey.KeyMetadata?.KeyId, use: 'sig', kty: 'EC', ...minJwkEntry };

    // 4. Get Existing JWKS.json file
    await backupJwksAddNewEntry(request, fullJwkEntry);

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Hello World!', ...request }),
    };
}

async function backupJwksAddNewEntry(request: RotateKeyRequest, fullJwkEntry: jose.JWK) {
    const s3Client = new S3Client({});
    const getObjectCommandInput: GetObjectCommandInput = {
        Bucket: request.publicKeysBucketName,
        Key: 'jwks.json',
    };
    const currentJwksEntry = await s3Client.send(new GetObjectCommand(getObjectCommandInput));

    // 5. Create JWKS.json backup?
    const putBackupObjectCommandInput: PutObjectCommandInput = {
        Bucket: request.publicKeysBucketName,
        Key: `jwks-${new Date().toISOString()}.bkp.json`,
        Body: currentJwksEntry.Body,
    };
    await s3Client.send(new PutObjectCommand(putBackupObjectCommandInput));

    // 6. Add JWKS entry to JWKS.json
    const oldJwksEntry: jose.JSONWebKeySet = JSON.parse(currentJwksEntry.Body);
    const newJwksEntry: jose.JSONWebKeySet = { keys: [...oldJwksEntry.keys, fullJwkEntry] };
    const putNewObjectCommandInput: PutObjectCommandInput = {
        Bucket: request.publicKeysBucketName,
        Key: `jwks.json`,
        Body: newJwksEntry,
    };
    await s3Client.send(new PutObjectCommand(putNewObjectCommandInput));

    // 7. Invalidate JWKS.json cloudfront distribution
    const cloudfrontClient = new CloudFrontClient({});
    const newInvalidationCommandInp: CreateInvalidationCommandInput = {
        DistributionId: request.cloudfrontDistributionId,
        InvalidationBatch: {
            CallerReference: new Date().toISOString(),
            Paths: {
                Quantity: 1,
                Items: ['jwks.json'],
            }
        }
    };
    await cloudfrontClient.send(new CreateInvalidationCommand(newInvalidationCommandInp));
}

async function createNewKmsKey(kmsClient: KMSClient, request: RotateKeyRequest) {
    const createKeyCommandInput: CreateKeyCommandInput = {
        KeySpec: KeySpec.ECC_NIST_P256,
        KeyUsage: KeyUsageType.SIGN_VERIFY,
        Tags: [
            {
                TagKey: 'purpose',
                TagValue: 'auto-rotate-test',
            },
        ],
    };
    const newKey = await kmsClient.send(new CreateKeyCommand(createKeyCommandInput));

    const createSigningGrantCommandInput: CreateGrantCommandInput = {
        Name: `Role ${request.canSignRoleArn} can Sign with key`,
        KeyId: newKey.KeyMetadata?.KeyId,
        GranteePrincipal: request.canSignRoleArn,
        Operations: [GrantOperation.DescribeKey, GrantOperation.GetPublicKey, GrantOperation.Sign, GrantOperation.Verify],
    };
    kmsClient.send(new CreateGrantCommand(createSigningGrantCommandInput));
    return newKey;
}

