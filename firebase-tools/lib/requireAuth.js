"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = exports.refreshAuth = void 0;
const google_auth_library_1 = require("google-auth-library");
const clc = require("colorette");
const api = require("./api");
const apiv2 = require("./apiv2");
const error_1 = require("./error");
const logger_1 = require("./logger");
const utils = require("./utils");
const scopes = require("./scopes");
const auth_1 = require("./auth");
const AUTH_ERROR_MESSAGE = `Command requires authentication, please run ${clc.bold("firebase login")}`;
let authClient;
let lastOptions;
function getAuthClient(config) {
    if (authClient) {
        return authClient;
    }
    authClient = new google_auth_library_1.GoogleAuth(config);
    return authClient;
}
async function autoAuth(options, authScopes) {
    var _a;
    const client = getAuthClient({ scopes: authScopes, projectId: options.project });
    const token = await client.getAccessToken();
    token !== null ? apiv2.setAccessToken(token) : false;
    logger_1.logger.debug(`Running auto auth`);
    let clientEmail;
    try {
        const credentials = await client.getCredentials();
        clientEmail = credentials.client_email;
    }
    catch (e) {
        logger_1.logger.debug(`Error getting account credentials.`);
    }
    if (process.env.MONOSPACE_ENV && token && clientEmail) {
        const activeAccount = {
            user: { email: clientEmail },
            tokens: {
                access_token: token,
                expires_at: (_a = client.cachedCredential) === null || _a === void 0 ? void 0 : _a.credentials.expiry_date,
            },
        };
        (0, auth_1.setActiveAccount)(options, activeAccount);
        (0, auth_1.setGlobalDefaultAccount)(activeAccount);
        options.projectId = await client.getProjectId();
    }
    return clientEmail;
}
async function refreshAuth() {
    if (!lastOptions) {
        throw new error_1.FirebaseError("Unable to refresh auth: not yet authenticated.");
    }
    await requireAuth(lastOptions);
    return lastOptions.tokens;
}
exports.refreshAuth = refreshAuth;
async function requireAuth(options) {
    lastOptions = options;
    api.setScopes([scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
    options.authScopes = api.getScopes();
    const tokens = options.tokens;
    const user = options.user;
    let tokenOpt = utils.getInheritedOption(options, "token");
    if (tokenOpt) {
        logger_1.logger.debug("> authorizing via --token option");
        utils.logWarning("Authenticating with `--token` is deprecated and will be removed in a future major version of `firebase-tools`. " +
            "Instead, use a service account key with `GOOGLE_APPLICATION_CREDENTIALS`: https://cloud.google.com/docs/authentication/getting-started");
    }
    else if (process.env.FIREBASE_TOKEN) {
        logger_1.logger.debug("> authorizing via FIREBASE_TOKEN environment variable");
        utils.logWarning("Authenticating with `FIREBASE_TOKEN` is deprecated and will be removed in a future major version of `firebase-tools`. " +
            "Instead, use a service account key with `GOOGLE_APPLICATION_CREDENTIALS`: https://cloud.google.com/docs/authentication/getting-started");
    }
    else if (user && (!(0, auth_1.isExpired)(tokens) || (tokens === null || tokens === void 0 ? void 0 : tokens.refresh_token))) {
        logger_1.logger.debug(`> authorizing via signed-in user (${user.email})`);
    }
    else {
        try {
            return await autoAuth(options, options.authScopes);
        }
        catch (e) {
            throw new error_1.FirebaseError(`Failed to authenticate, have you run ${clc.bold("firebase login")}?`, { original: e });
        }
    }
    tokenOpt = tokenOpt || process.env.FIREBASE_TOKEN;
    if (tokenOpt) {
        (0, auth_1.setRefreshToken)(tokenOpt);
        return;
    }
    if (!user || !tokens) {
        throw new error_1.FirebaseError(AUTH_ERROR_MESSAGE);
    }
    (0, auth_1.setActiveAccount)(options, { user, tokens });
    return user.email;
}
exports.requireAuth = requireAuth;
