"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitHubCommit = exports.getGitHubBranch = exports.fetchRepositoryCloneUris = exports.listAppHostingConnections = exports.getOrCreateRepository = exports.getOrCreateConnection = exports.createConnection = exports.ensureSecretManagerAdminGrant = exports.promptGitHubBranch = exports.getOrCreateOauthConnection = exports.listValidInstallations = exports.promptGitHubInstallation = exports.getConnectionForInstallation = exports.linkGitHubRepository = exports.getOrCreateGithubConnectionWithSentinel = exports.generateRepositoryId = exports.extractRepoSlugFromUri = exports.parseConnectionName = void 0;
const clc = require("colorette");
const devConnect = require("../gcp/devConnect");
const rm = require("../gcp/resourceManager");
const poller = require("../operation-poller");
const utils = require("../utils");
const error_1 = require("../error");
const prompt_1 = require("../prompt");
const getProjectNumber_1 = require("../getProjectNumber");
const api_1 = require("../api");
const fuzzy = require("fuzzy");
const inquirer = require("inquirer");
const apiv2_1 = require("../apiv2");
const githubApiClient = new apiv2_1.Client({ urlPrefix: (0, api_1.githubApiOrigin)(), auth: false });
const APPHOSTING_CONN_PATTERN = /.+\/apphosting-github-conn-.+$/;
const APPHOSTING_OAUTH_CONN_NAME = "firebase-app-hosting-github-oauth";
const CONNECTION_NAME_REGEX = /^projects\/(?<projectId>[^\/]+)\/locations\/(?<location>[^\/]+)\/connections\/(?<id>[^\/]+)$/;
function parseConnectionName(name) {
    const match = CONNECTION_NAME_REGEX.exec(name);
    if (!match || typeof match.groups === undefined) {
        return;
    }
    const { projectId, location, id } = match.groups;
    return {
        projectId,
        location,
        id,
    };
}
exports.parseConnectionName = parseConnectionName;
const devConnectPollerOptions = {
    apiOrigin: (0, api_1.developerConnectOrigin)(),
    apiVersion: "v1",
    masterTimeout: 25 * 60 * 1000,
    maxBackoff: 10000,
};
function extractRepoSlugFromUri(cloneUri) {
    const match = /github.com\/(.+).git/.exec(cloneUri);
    if (!match) {
        return undefined;
    }
    return match[1];
}
exports.extractRepoSlugFromUri = extractRepoSlugFromUri;
function generateRepositoryId(remoteUri) {
    var _a;
    return (_a = extractRepoSlugFromUri(remoteUri)) === null || _a === void 0 ? void 0 : _a.replaceAll("/", "-");
}
exports.generateRepositoryId = generateRepositoryId;
function generateConnectionId() {
    const randomHash = Math.random().toString(36).slice(6);
    return `apphosting-github-conn-${randomHash}`;
}
const ADD_ACCOUNT_CHOICE = "@ADD_ACCOUNT";
const MANAGE_INSTALLATION_CHOICE = "@MANAGE_INSTALLATION";
async function getOrCreateGithubConnectionWithSentinel(projectId, location, createConnectionId) {
    utils.logBullet(clc.bold(`${clc.yellow("===")} Import a GitHub repository`));
    if (createConnectionId) {
        try {
            const connection = await devConnect.getConnection(projectId, location, createConnectionId);
            utils.logBullet(`Reusing existing connection ${createConnectionId}`);
            return connection;
        }
        catch (err) {
            if (err.status !== 404) {
                throw err;
            }
        }
    }
    const oauthConn = await getOrCreateOauthConnection(projectId, location);
    let installationId = await promptGitHubInstallation(projectId, location, oauthConn);
    while (installationId === ADD_ACCOUNT_CHOICE) {
        utils.logBullet("Install the Firebase App Hosting GitHub app on a new account to enable access to those repositories");
        const apphostingGitHubInstallationURL = (0, api_1.apphostingGitHubAppInstallationURL)();
        utils.logBullet(apphostingGitHubInstallationURL);
        await utils.openInBrowser(apphostingGitHubInstallationURL);
        await (0, prompt_1.promptOnce)({
            type: "input",
            message: "Press Enter once you have installed or configured the Firebase App Hosting GitHub app to access your GitHub repo.",
        });
        installationId = await promptGitHubInstallation(projectId, location, oauthConn);
    }
    const connectionMatchingInstallation = await getConnectionForInstallation(projectId, location, installationId);
    if (connectionMatchingInstallation) {
        const { id: matchingConnectionId } = parseConnectionName(connectionMatchingInstallation.name);
        if (!createConnectionId) {
            utils.logBullet(`Reusing matching connection ${matchingConnectionId}`);
            return connectionMatchingInstallation;
        }
    }
    if (!createConnectionId) {
        createConnectionId = generateConnectionId();
    }
    const connection = await createFullyInstalledConnection(projectId, location, createConnectionId, oauthConn, installationId);
    return connection;
}
exports.getOrCreateGithubConnectionWithSentinel = getOrCreateGithubConnectionWithSentinel;
async function linkGitHubRepository(projectId, location, createConnectionId) {
    var _a, _b;
    const connection = await getOrCreateGithubConnectionWithSentinel(projectId, location, createConnectionId);
    let repoCloneUri;
    do {
        if (repoCloneUri === MANAGE_INSTALLATION_CHOICE) {
            await manageInstallation(connection);
        }
        repoCloneUri = await promptCloneUri(projectId, connection);
    } while (repoCloneUri === MANAGE_INSTALLATION_CHOICE);
    const { id: connectionId } = parseConnectionName(connection.name);
    await getOrCreateConnection(projectId, location, connectionId, {
        authorizerCredential: (_a = connection.githubConfig) === null || _a === void 0 ? void 0 : _a.authorizerCredential,
        appInstallationId: (_b = connection.githubConfig) === null || _b === void 0 ? void 0 : _b.appInstallationId,
    });
    const repo = await getOrCreateRepository(projectId, location, connectionId, repoCloneUri);
    return repo;
}
exports.linkGitHubRepository = linkGitHubRepository;
async function createFullyInstalledConnection(projectId, location, connectionId, oauthConn, installationId) {
    var _a;
    let conn = await createConnection(projectId, location, connectionId, {
        appInstallationId: installationId,
        authorizerCredential: (_a = oauthConn.githubConfig) === null || _a === void 0 ? void 0 : _a.authorizerCredential,
    });
    while (conn.installationState.stage !== "COMPLETE") {
        utils.logBullet("Install the Firebase App Hosting GitHub app to enable access to GitHub repositories");
        const targetUri = conn.installationState.actionUri;
        utils.logBullet(targetUri);
        await utils.openInBrowser(targetUri);
        await (0, prompt_1.promptOnce)({
            type: "input",
            message: "Press Enter once you have installed or configured the Firebase App Hosting GitHub app to access your GitHub repo.",
        });
        conn = await devConnect.getConnection(projectId, location, connectionId);
    }
    return conn;
}
async function manageInstallation(connection) {
    var _a;
    utils.logBullet("Manage the Firebase App Hosting GitHub app to enable access to GitHub repositories");
    const targetUri = (_a = connection.githubConfig) === null || _a === void 0 ? void 0 : _a.installationUri;
    if (!targetUri) {
        throw new error_1.FirebaseError("Failed to get Installation URI. Please try again.");
    }
    utils.logBullet(targetUri);
    await utils.openInBrowser(targetUri);
    await (0, prompt_1.promptOnce)({
        type: "input",
        message: "Press Enter once you have installed or configured the Firebase App Hosting GitHub app to access your GitHub repo.",
    });
}
async function getConnectionForInstallation(projectId, location, installationId) {
    const connections = await listAppHostingConnections(projectId, location);
    const connectionsMatchingInstallation = connections.filter((conn) => { var _a; return ((_a = conn.githubConfig) === null || _a === void 0 ? void 0 : _a.appInstallationId) === installationId; });
    if (connectionsMatchingInstallation.length === 0) {
        return null;
    }
    if (connectionsMatchingInstallation.length > 1) {
        const sorted = devConnect.sortConnectionsByCreateTime(connectionsMatchingInstallation);
        return sorted[0];
    }
    return connectionsMatchingInstallation[0];
}
exports.getConnectionForInstallation = getConnectionForInstallation;
async function promptGitHubInstallation(projectId, location, connection) {
    const installations = await listValidInstallations(projectId, location, connection);
    const installationName = await (0, prompt_1.promptOnce)({
        type: "autocomplete",
        name: "installation",
        message: "Which GitHub account do you want to use?",
        source: (_, input = "") => {
            return new Promise((resolve) => resolve([
                new inquirer.Separator(),
                {
                    name: "Missing an account? Select this option to add a GitHub account",
                    value: ADD_ACCOUNT_CHOICE,
                },
                new inquirer.Separator(),
                ...fuzzy
                    .filter(input, installations, {
                    extract: (installation) => installation.name || "",
                })
                    .map((result) => {
                    return {
                        name: result.original.name || "",
                        value: result.original.id,
                    };
                }),
            ]));
        },
    });
    return installationName;
}
exports.promptGitHubInstallation = promptGitHubInstallation;
async function listValidInstallations(projectId, location, connection) {
    const { id: connId } = parseConnectionName(connection.name);
    let installations = await devConnect.fetchGitHubInstallations(projectId, location, connId);
    installations = installations.filter((installation) => {
        var _a, _b;
        return ((installation.type === "user" &&
            installation.name === ((_b = (_a = connection.githubConfig) === null || _a === void 0 ? void 0 : _a.authorizerCredential) === null || _b === void 0 ? void 0 : _b.username)) ||
            installation.type === "organization");
    });
    return installations;
}
exports.listValidInstallations = listValidInstallations;
async function getOrCreateOauthConnection(projectId, location) {
    let conn;
    try {
        conn = await devConnect.getConnection(projectId, location, APPHOSTING_OAUTH_CONN_NAME);
    }
    catch (err) {
        if (err.status === 404) {
            await ensureSecretManagerAdminGrant(projectId);
            conn = await createConnection(projectId, location, APPHOSTING_OAUTH_CONN_NAME);
        }
        else {
            throw err;
        }
    }
    while (conn.installationState.stage === "PENDING_USER_OAUTH") {
        utils.logBullet("Please authorize the Firebase GitHub app by visiting this url:");
        const { url, cleanup } = await utils.openInBrowserPopup(conn.installationState.actionUri, "Authorize the GitHub app");
        utils.logBullet(`\t${url}`);
        await (0, prompt_1.promptOnce)({
            type: "input",
            message: "Press Enter once you have authorized the GitHub App.",
        });
        cleanup();
        const { projectId, location, id } = parseConnectionName(conn.name);
        conn = await devConnect.getConnection(projectId, location, id);
    }
    utils.logSuccess("Connected with GitHub successfully\n");
    return conn;
}
exports.getOrCreateOauthConnection = getOrCreateOauthConnection;
async function promptCloneUri(projectId, connection) {
    const cloneUris = await fetchRepositoryCloneUris(projectId, connection);
    const cloneUri = await (0, prompt_1.promptOnce)({
        type: "autocomplete",
        name: "cloneUri",
        message: "Which GitHub repo do you want to deploy?",
        source: (_, input = "") => {
            return new Promise((resolve) => resolve([
                new inquirer.Separator(),
                {
                    name: "Missing a repo? Select this option to configure your GitHub connection settings",
                    value: MANAGE_INSTALLATION_CHOICE,
                },
                new inquirer.Separator(),
                ...fuzzy
                    .filter(input, cloneUris, {
                    extract: (uri) => extractRepoSlugFromUri(uri) || "",
                })
                    .map((result) => {
                    return {
                        name: extractRepoSlugFromUri(result.original) || "",
                        value: result.original,
                    };
                }),
            ]));
        },
    });
    return cloneUri;
}
async function promptGitHubBranch(repoLink) {
    const branches = await devConnect.listAllBranches(repoLink.name);
    const branch = await (0, prompt_1.promptOnce)({
        type: "autocomplete",
        name: "branch",
        message: "Pick a branch for continuous deployment",
        source: (_, input = "") => {
            return new Promise((resolve) => resolve([
                ...fuzzy.filter(input, Array.from(branches)).map((result) => {
                    return {
                        name: result.original,
                        value: result.original,
                    };
                }),
            ]));
        },
    });
    return branch;
}
exports.promptGitHubBranch = promptGitHubBranch;
async function ensureSecretManagerAdminGrant(projectId) {
    const projectNumber = await (0, getProjectNumber_1.getProjectNumber)({ projectId });
    const dcsaEmail = devConnect.serviceAgentEmail(projectNumber);
    const alreadyGranted = await rm.serviceAccountHasRoles(projectId, dcsaEmail, ["roles/secretmanager.admin"], true);
    if (alreadyGranted) {
        utils.logBullet("secret manager admin role already granted");
        return;
    }
    utils.logBullet("To create a new GitHub connection, Secret Manager Admin role (roles/secretmanager.admin) is required on the Developer Connect Service Agent.");
    const grant = await (0, prompt_1.promptOnce)({
        type: "confirm",
        message: "Grant the required role to the Developer Connect Service Agent?",
    });
    if (!grant) {
        utils.logBullet("You, or your project administrator, should run the following command to grant the required role:\n\n" +
            "You, or your project adminstrator, can run the following command to grant the required role manually:\n\n" +
            `\tgcloud projects add-iam-policy-binding ${projectId} \\\n` +
            `\t  --member="serviceAccount:${dcsaEmail} \\\n` +
            `\t  --role="roles/secretmanager.admin\n`);
        throw new error_1.FirebaseError("Insufficient IAM permissions to create a new connection to GitHub");
    }
    try {
        await rm.addServiceAccountToRoles(projectId, dcsaEmail, ["roles/secretmanager.admin"], true);
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) === 400 || (e === null || e === void 0 ? void 0 : e.status) === 400) {
            await devConnect.generateP4SA(projectNumber);
            await rm.addServiceAccountToRoles(projectId, dcsaEmail, ["roles/secretmanager.admin"], true);
        }
        else {
            throw e;
        }
    }
    utils.logSuccess("Successfully granted the required role to the Developer Connect Service Agent!\n");
}
exports.ensureSecretManagerAdminGrant = ensureSecretManagerAdminGrant;
async function createConnection(projectId, location, connectionId, githubConfig) {
    const op = await devConnect.createConnection(projectId, location, connectionId, githubConfig);
    const conn = await poller.pollOperation(Object.assign(Object.assign({}, devConnectPollerOptions), { pollerName: `create-${location}-${connectionId}`, operationResourceName: op.name }));
    return conn;
}
exports.createConnection = createConnection;
async function getOrCreateConnection(projectId, location, connectionId, githubConfig) {
    let conn;
    try {
        conn = await devConnect.getConnection(projectId, location, connectionId);
    }
    catch (err) {
        if (err.status === 404) {
            utils.logBullet("creating connection");
            conn = await createConnection(projectId, location, connectionId, githubConfig);
        }
        else {
            throw err;
        }
    }
    return conn;
}
exports.getOrCreateConnection = getOrCreateConnection;
async function getOrCreateRepository(projectId, location, connectionId, cloneUri) {
    const repositoryId = generateRepositoryId(cloneUri);
    if (!repositoryId) {
        throw new error_1.FirebaseError(`Failed to generate repositoryId for URI "${cloneUri}".`);
    }
    let repo;
    try {
        repo = await devConnect.getGitRepositoryLink(projectId, location, connectionId, repositoryId);
    }
    catch (err) {
        if (err.status === 404) {
            const op = await devConnect.createGitRepositoryLink(projectId, location, connectionId, repositoryId, cloneUri);
            repo = await poller.pollOperation(Object.assign(Object.assign({}, devConnectPollerOptions), { pollerName: `create-${location}-${connectionId}-${repositoryId}`, operationResourceName: op.name }));
        }
        else {
            throw err;
        }
    }
    return repo;
}
exports.getOrCreateRepository = getOrCreateRepository;
async function listAppHostingConnections(projectId, location) {
    const conns = await devConnect.listAllConnections(projectId, location);
    return conns.filter((conn) => APPHOSTING_CONN_PATTERN.test(conn.name) &&
        conn.installationState.stage === "COMPLETE" &&
        !conn.disabled);
}
exports.listAppHostingConnections = listAppHostingConnections;
async function fetchRepositoryCloneUris(projectId, connection) {
    const { location, id } = parseConnectionName(connection.name);
    const connectionRepos = await devConnect.listAllLinkableGitRepositories(projectId, location, id);
    const cloneUris = connectionRepos.map((conn) => conn.cloneUri);
    return cloneUris;
}
exports.fetchRepositoryCloneUris = fetchRepositoryCloneUris;
async function getGitHubBranch(owner, repo, branch, readToken) {
    const headers = { Authorization: `Bearer ${readToken}`, "User-Agent": "Firebase CLI" };
    const { body } = await githubApiClient.get(`/repos/${owner}/${repo}/branches/${branch}`, {
        headers,
    });
    return body;
}
exports.getGitHubBranch = getGitHubBranch;
async function getGitHubCommit(owner, repo, ref, readToken) {
    const headers = { Authorization: `Bearer ${readToken}`, "User-Agent": "Firebase CLI" };
    const { body } = await githubApiClient.get(`/repos/${owner}/${repo}/commits/${ref}`, {
        headers,
    });
    return body;
}
exports.getGitHubCommit = getGitHubCommit;
