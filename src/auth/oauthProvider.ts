import { randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
    OAuthServerProvider,
    AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
    OAuthClientInformationFull,
    OAuthTokens,
    OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';

interface StoredAuthCode {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: number;
}

interface StoredToken {
    clientId: string;
    scopes: string[];
    expiresAt: number;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class GhostOAuthProvider implements OAuthServerProvider {
    private clients = new Map<string, OAuthClientInformationFull>();
    private authCodes = new Map<string, StoredAuthCode>();
    private accessTokens = new Map<string, StoredToken>();
    private refreshTokens = new Map<string, StoredToken>();

    readonly clientsStore: OAuthRegisteredClientsStore;

    constructor(
        private readonly password: string,
        private readonly issuerUrl: string,
    ) {
        this.clientsStore = {
            getClient: async (clientId: string) => this.clients.get(clientId),
            registerClient: async (
                client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
            ) => {
                const full: OAuthClientInformationFull = {
                    ...client,
                    client_id: randomUUID(),
                    client_id_issued_at: Math.floor(Date.now() / 1000),
                };
                this.clients.set(full.client_id, full);
                return full;
            },
        };
    }

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response,
    ): Promise<void> {
        const query = new URLSearchParams({
            client_id: client.client_id,
            redirect_uri: params.redirectUri,
            code_challenge: params.codeChallenge,
            state: params.state ?? '',
            scope: params.scopes?.join(' ') ?? '',
        });
        res.redirect(`/login?${query.toString()}`);
    }

    async challengeForAuthorizationCode(
        _client: OAuthClientInformationFull,
        authorizationCode: string,
    ): Promise<string> {
        const stored = this.authCodes.get(authorizationCode);
        if (!stored || stored.expiresAt < Date.now()) {
            throw new Error('Invalid or expired authorization code');
        }
        return stored.codeChallenge;
    }

    async exchangeAuthorizationCode(
        _client: OAuthClientInformationFull,
        authorizationCode: string,
    ): Promise<OAuthTokens> {
        const stored = this.authCodes.get(authorizationCode);
        if (!stored || stored.expiresAt < Date.now()) {
            throw new Error('Invalid or expired authorization code');
        }
        this.authCodes.delete(authorizationCode);

        const accessToken = randomBytes(32).toString('hex');
        const refreshToken = randomBytes(32).toString('hex');

        this.accessTokens.set(accessToken, {
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Date.now() + ONE_HOUR_MS,
        });

        this.refreshTokens.set(refreshToken, {
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Date.now() + THIRTY_DAYS_MS,
        });

        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: refreshToken,
            scope: stored.scopes.join(' '),
        };
    }

    async exchangeRefreshToken(
        _client: OAuthClientInformationFull,
        refreshToken: string,
        scopes?: string[],
    ): Promise<OAuthTokens> {
        const stored = this.refreshTokens.get(refreshToken);
        if (!stored || stored.expiresAt < Date.now()) {
            throw new Error('Invalid or expired refresh token');
        }

        const tokenScopes = scopes ?? stored.scopes;
        const accessToken = randomBytes(32).toString('hex');

        this.accessTokens.set(accessToken, {
            clientId: stored.clientId,
            scopes: tokenScopes,
            expiresAt: Date.now() + ONE_HOUR_MS,
        });

        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: refreshToken,
            scope: tokenScopes.join(' '),
        };
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const stored = this.accessTokens.get(token);
        if (!stored || stored.expiresAt < Date.now()) {
            throw new Error('Invalid or expired access token');
        }
        return {
            token,
            clientId: stored.clientId,
            scopes: stored.scopes,
            expiresAt: Math.floor(stored.expiresAt / 1000),
        };
    }

    async revokeToken(
        _client: OAuthClientInformationFull,
        request: OAuthTokenRevocationRequest,
    ): Promise<void> {
        this.accessTokens.delete(request.token);
        this.refreshTokens.delete(request.token);
    }

    validatePassword(password: string): boolean {
        return password === this.password;
    }

    generateAuthCode(
        clientId: string,
        codeChallenge: string,
        redirectUri: string,
        scopes: string[],
    ): string {
        const code = randomBytes(32).toString('hex');
        this.authCodes.set(code, {
            clientId,
            codeChallenge,
            redirectUri,
            scopes,
            expiresAt: Date.now() + TEN_MINUTES_MS,
        });
        return code;
    }
}
