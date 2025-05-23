"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findIntelligentPathForAndroid = exports.findIntelligentPathForIOS = exports.deleteAppAndroidSha = exports.createAppAndroidSha = exports.listAppAndroidSha = exports.getAppConfig = exports.writeConfigToFile = exports.getAppConfigFile = exports.listFirebaseApps = exports.createWebApp = exports.createAndroidApp = exports.createIosApp = exports.getAppPlatform = exports.ShaCertificateType = exports.AppPlatform = exports.getSdkConfig = exports.checkForApps = exports.getSdkOutputPath = exports.sdkInit = exports.getPlatform = exports.APP_LIST_PAGE_SIZE = void 0;
const fs = require("fs-extra");
const ora = require("ora");
const path = require("path");
const apiv2_1 = require("../apiv2");
const api_1 = require("../api");
const error_1 = require("../error");
const logger_1 = require("../logger");
const operation_poller_1 = require("../operation-poller");
const types_1 = require("../dataconnect/types");
const projectUtils_1 = require("../projectUtils");
const prompt_1 = require("../prompt");
const projects_1 = require("./projects");
const fileUtils_1 = require("../dataconnect/fileUtils");
const utils_1 = require("../utils");
const TIMEOUT_MILLIS = 30000;
exports.APP_LIST_PAGE_SIZE = 100;
const CREATE_APP_API_REQUEST_TIMEOUT_MILLIS = 15000;
const DISPLAY_NAME_QUESTION = {
    type: "input",
    name: "displayName",
    default: "",
    message: "What would you like to call your app?",
};
async function getPlatform(appDir, config) {
    let targetPlatform = await (0, fileUtils_1.getPlatformFromFolder)(appDir);
    if (targetPlatform === types_1.Platform.NONE) {
        appDir = await (0, prompt_1.promptForDirectory)({
            config,
            relativeTo: appDir,
            message: "We couldn't determine what kind of app you're using. Where is your app directory?",
        });
        targetPlatform = await (0, fileUtils_1.getPlatformFromFolder)(appDir);
    }
    if (targetPlatform === types_1.Platform.NONE || targetPlatform === types_1.Platform.MULTIPLE) {
        if (targetPlatform === types_1.Platform.NONE) {
            (0, utils_1.logBullet)(`Couldn't automatically detect app your in directory ${appDir}.`);
        }
        else {
            (0, utils_1.logSuccess)(`Detected multiple app platforms in directory ${appDir}`);
        }
        const platforms = [
            { name: "iOS (Swift)", value: types_1.Platform.IOS },
            { name: "Web (JavaScript)", value: types_1.Platform.WEB },
            { name: "Android (Kotlin)", value: types_1.Platform.ANDROID },
        ];
        targetPlatform = await (0, prompt_1.promptOnce)({
            message: "Which platform do you want to set up an SDK for? Note: We currently do not support automatically setting up C++ or Unity projects.",
            type: "list",
            choices: platforms,
        });
    }
    else if (targetPlatform === types_1.Platform.FLUTTER) {
        (0, utils_1.logWarning)(`Detected ${targetPlatform} app in directory ${appDir}`);
        throw new error_1.FirebaseError(`Flutter is not supported by apps:configure.
Please follow the link below to set up firebase for your Flutter app:
https://firebase.google.com/docs/flutter/setup
    `);
    }
    else {
        (0, utils_1.logSuccess)(`Detected ${targetPlatform} app in directory ${appDir}`);
    }
    return targetPlatform === types_1.Platform.MULTIPLE
        ? AppPlatform.PLATFORM_UNSPECIFIED
        : targetPlatform;
}
exports.getPlatform = getPlatform;
async function initiateIosAppCreation(options) {
    if (!options.nonInteractive) {
        await (0, prompt_1.prompt)(options, [
            DISPLAY_NAME_QUESTION,
            {
                type: "input",
                default: "",
                name: "bundleId",
                message: "Please specify your iOS app bundle ID:",
            },
            {
                type: "input",
                default: "",
                name: "appStoreId",
                message: "Please specify your iOS app App Store ID:",
            },
        ]);
    }
    if (!options.bundleId) {
        throw new error_1.FirebaseError("Bundle ID for iOS app cannot be empty");
    }
    const spinner = ora("Creating your iOS app").start();
    try {
        const appData = await createIosApp(options.project, {
            displayName: options.displayName,
            bundleId: options.bundleId,
            appStoreId: options.appStoreId,
        });
        spinner.succeed();
        return appData;
    }
    catch (err) {
        spinner.fail();
        throw err;
    }
}
async function initiateAndroidAppCreation(options) {
    if (!options.nonInteractive) {
        await (0, prompt_1.prompt)(options, [
            DISPLAY_NAME_QUESTION,
            {
                type: "input",
                default: "",
                name: "packageName",
                message: "Please specify your Android app package name:",
            },
        ]);
    }
    if (!options.packageName) {
        throw new error_1.FirebaseError("Package name for Android app cannot be empty");
    }
    const spinner = ora("Creating your Android app").start();
    try {
        const appData = await createAndroidApp(options.project, {
            displayName: options.displayName,
            packageName: options.packageName,
        });
        spinner.succeed();
        return appData;
    }
    catch (err) {
        spinner.fail();
        throw err;
    }
}
async function initiateWebAppCreation(options) {
    if (!options.nonInteractive) {
        await (0, prompt_1.prompt)(options, [DISPLAY_NAME_QUESTION]);
    }
    if (!options.displayName) {
        throw new error_1.FirebaseError("Display name for Web app cannot be empty");
    }
    const spinner = ora("Creating your Web app").start();
    try {
        const appData = await createWebApp(options.project, { displayName: options.displayName });
        spinner.succeed();
        return appData;
    }
    catch (err) {
        spinner.fail();
        throw err;
    }
}
async function sdkInit(appPlatform, options) {
    let appData;
    switch (appPlatform) {
        case AppPlatform.IOS:
            appData = await initiateIosAppCreation(options);
            break;
        case AppPlatform.ANDROID:
            appData = await initiateAndroidAppCreation(options);
            break;
        case AppPlatform.WEB:
            appData = await initiateWebAppCreation(options);
            break;
        default:
            throw new error_1.FirebaseError("Unexpected error. This should not happen");
    }
    return appData;
}
exports.sdkInit = sdkInit;
async function getSdkOutputPath(appDir, platform, config) {
    switch (platform) {
        case AppPlatform.ANDROID:
            const androidPath = await findIntelligentPathForAndroid(appDir, config);
            return path.join(androidPath, "google-services.json");
        case AppPlatform.WEB:
            return path.join(appDir, "firebase-js-config.json");
        case AppPlatform.IOS:
            const iosPath = await findIntelligentPathForIOS(appDir, config);
            return path.join(iosPath, "GoogleService-Info.plist");
    }
    throw new error_1.FirebaseError("Platform " + platform.toString() + " is not supported yet.");
}
exports.getSdkOutputPath = getSdkOutputPath;
function checkForApps(apps, appPlatform) {
    if (!apps.length) {
        throw new error_1.FirebaseError(`There are no ${appPlatform === AppPlatform.ANY ? "" : appPlatform + " "}apps ` +
            "associated with this Firebase project");
    }
}
exports.checkForApps = checkForApps;
async function selectAppInteractively(apps, appPlatform) {
    checkForApps(apps, appPlatform);
    const choices = apps.map((app) => {
        return {
            name: `${app.displayName || app.bundleId || app.packageName}` +
                ` - ${app.appId} (${app.platform})`,
            value: app,
        };
    });
    return await (0, prompt_1.promptOnce)({
        type: "list",
        message: `Select the ${appPlatform === AppPlatform.ANY ? "" : appPlatform + " "}` +
            "app to get the configuration data:",
        choices,
    });
}
async function getSdkConfig(options, appPlatform, appId) {
    if (!appId) {
        let projectId = (0, projectUtils_1.needProjectId)(options);
        if (options.nonInteractive && !projectId) {
            throw new error_1.FirebaseError("Must supply app and project ids in non-interactive mode.");
        }
        else if (!projectId) {
            const result = await (0, projects_1.getOrPromptProject)(options);
            projectId = result.projectId;
        }
        const apps = await listFirebaseApps(projectId, appPlatform);
        checkForApps(apps, appPlatform);
        if (apps.length === 1) {
            appId = apps[0].appId;
            appPlatform = apps[0].platform;
        }
        else if (options.nonInteractive) {
            throw new error_1.FirebaseError(`Project ${projectId} has multiple apps, must specify an app id.`);
        }
        else {
            const appMetadata = await selectAppInteractively(apps, appPlatform);
            appId = appMetadata.appId;
            appPlatform = appMetadata.platform;
        }
    }
    let configData;
    const spinner = ora(`Downloading configuration data for your Firebase ${appPlatform} app`).start();
    try {
        configData = await getAppConfig(appId, appPlatform);
    }
    catch (err) {
        spinner.fail();
        throw err;
    }
    spinner.succeed();
    return configData;
}
exports.getSdkConfig = getSdkConfig;
var AppPlatform;
(function (AppPlatform) {
    AppPlatform["PLATFORM_UNSPECIFIED"] = "PLATFORM_UNSPECIFIED";
    AppPlatform["IOS"] = "IOS";
    AppPlatform["ANDROID"] = "ANDROID";
    AppPlatform["WEB"] = "WEB";
    AppPlatform["ANY"] = "ANY";
})(AppPlatform = exports.AppPlatform || (exports.AppPlatform = {}));
var ShaCertificateType;
(function (ShaCertificateType) {
    ShaCertificateType["SHA_CERTIFICATE_TYPE_UNSPECIFIED"] = "SHA_CERTIFICATE_TYPE_UNSPECIFIED";
    ShaCertificateType["SHA_1"] = "SHA_1";
    ShaCertificateType["SHA_256"] = "SHA_256";
})(ShaCertificateType = exports.ShaCertificateType || (exports.ShaCertificateType = {}));
function getAppPlatform(platform) {
    switch (platform.toUpperCase()) {
        case "IOS":
            return AppPlatform.IOS;
        case "ANDROID":
            return AppPlatform.ANDROID;
        case "WEB":
            return AppPlatform.WEB;
        case "":
            return AppPlatform.ANY;
        default:
            throw new error_1.FirebaseError("Unexpected platform. Only iOS, Android, and Web apps are supported");
    }
}
exports.getAppPlatform = getAppPlatform;
const apiClient = new apiv2_1.Client({ urlPrefix: (0, api_1.firebaseApiOrigin)(), apiVersion: "v1beta1" });
async function createIosApp(projectId, options) {
    try {
        const response = await apiClient.request({
            method: "POST",
            path: `/projects/${projectId}/iosApps`,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
            body: options,
        });
        const appData = await (0, operation_poller_1.pollOperation)({
            pollerName: "Create iOS app Poller",
            apiOrigin: (0, api_1.firebaseApiOrigin)(),
            apiVersion: "v1beta1",
            operationResourceName: response.body.name,
        });
        return appData;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to create iOS app for project ${projectId}. See firebase-debug.log for more info.`, { exit: 2, original: err });
    }
}
exports.createIosApp = createIosApp;
async function createAndroidApp(projectId, options) {
    try {
        const response = await apiClient.request({
            method: "POST",
            path: `/projects/${projectId}/androidApps`,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
            body: options,
        });
        const appData = await (0, operation_poller_1.pollOperation)({
            pollerName: "Create Android app Poller",
            apiOrigin: (0, api_1.firebaseApiOrigin)(),
            apiVersion: "v1beta1",
            operationResourceName: response.body.name,
        });
        return appData;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to create Android app for project ${projectId}. See firebase-debug.log for more info.`, {
            exit: 2,
            original: err,
        });
    }
}
exports.createAndroidApp = createAndroidApp;
async function createWebApp(projectId, options) {
    try {
        const response = await apiClient.request({
            method: "POST",
            path: `/projects/${projectId}/webApps`,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
            body: options,
        });
        const appData = await (0, operation_poller_1.pollOperation)({
            pollerName: "Create Web app Poller",
            apiOrigin: (0, api_1.firebaseApiOrigin)(),
            apiVersion: "v1beta1",
            operationResourceName: response.body.name,
        });
        return appData;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to create Web app for project ${projectId}. See firebase-debug.log for more info.`, { exit: 2, original: err });
    }
}
exports.createWebApp = createWebApp;
function getListAppsResourceString(projectId, platform) {
    let resourceSuffix;
    switch (platform) {
        case AppPlatform.IOS:
            resourceSuffix = "/iosApps";
            break;
        case AppPlatform.ANDROID:
            resourceSuffix = "/androidApps";
            break;
        case AppPlatform.WEB:
            resourceSuffix = "/webApps";
            break;
        case AppPlatform.ANY:
            resourceSuffix = ":searchApps";
            break;
        default:
            throw new error_1.FirebaseError("Unexpected platform. Only support iOS, Android and Web apps");
    }
    return `/projects/${projectId}${resourceSuffix}`;
}
async function listFirebaseApps(projectId, platform, pageSize = exports.APP_LIST_PAGE_SIZE) {
    const apps = [];
    try {
        let nextPageToken;
        do {
            const queryParams = { pageSize };
            if (nextPageToken) {
                queryParams.pageToken = nextPageToken;
            }
            const response = await apiClient.request({
                method: "GET",
                path: getListAppsResourceString(projectId, platform),
                queryParams,
                timeout: TIMEOUT_MILLIS,
            });
            if (response.body.apps) {
                const appsOnPage = response.body.apps.map((app) => (app.platform ? app : Object.assign(Object.assign({}, app), { platform })));
                apps.push(...appsOnPage);
            }
            nextPageToken = response.body.nextPageToken;
        } while (nextPageToken);
        return apps;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to list Firebase ${platform === AppPlatform.ANY ? "" : platform + " "}` +
            "apps. See firebase-debug.log for more info.", {
            exit: 2,
            original: err,
        });
    }
}
exports.listFirebaseApps = listFirebaseApps;
function getAppConfigResourceString(appId, platform) {
    let platformResource;
    switch (platform) {
        case AppPlatform.IOS:
            platformResource = "iosApps";
            break;
        case AppPlatform.ANDROID:
            platformResource = "androidApps";
            break;
        case AppPlatform.WEB:
            platformResource = "webApps";
            break;
        default:
            throw new error_1.FirebaseError("Unexpected app platform");
    }
    return `/projects/-/${platformResource}/${appId}/config`;
}
function parseConfigFromResponse(responseBody, platform) {
    if (platform === AppPlatform.WEB) {
        return {
            fileName: "firebase-js-config.json",
            fileContents: JSON.stringify(responseBody, null, 2),
        };
    }
    else if ("configFilename" in responseBody) {
        return {
            fileName: responseBody.configFilename,
            fileContents: Buffer.from(responseBody.configFileContents, "base64").toString("utf8"),
        };
    }
    throw new error_1.FirebaseError("Unexpected app platform");
}
function getAppConfigFile(config, platform) {
    return parseConfigFromResponse(config, platform);
}
exports.getAppConfigFile = getAppConfigFile;
async function writeConfigToFile(filename, nonInteractive, fileContents) {
    if (fs.existsSync(filename)) {
        if (nonInteractive) {
            throw new error_1.FirebaseError(`${filename} already exists`);
        }
        const overwrite = await (0, prompt_1.promptOnce)({
            type: "confirm",
            default: false,
            message: `${filename} already exists. Do you want to overwrite?`,
        });
        if (!overwrite) {
            return false;
        }
    }
    await fs.writeFile(filename, fileContents);
    return true;
}
exports.writeConfigToFile = writeConfigToFile;
async function getAppConfig(appId, platform) {
    try {
        const response = await apiClient.request({
            method: "GET",
            path: getAppConfigResourceString(appId, platform),
            timeout: TIMEOUT_MILLIS,
        });
        return response.body;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to get ${platform} app configuration. See firebase-debug.log for more info.`, {
            exit: 2,
            original: err,
        });
    }
}
exports.getAppConfig = getAppConfig;
async function listAppAndroidSha(projectId, appId) {
    const shaCertificates = [];
    try {
        const response = await apiClient.request({
            method: "GET",
            path: `/projects/${projectId}/androidApps/${appId}/sha`,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
        });
        if (response.body.certificates) {
            shaCertificates.push(...response.body.certificates);
        }
        return shaCertificates;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to list SHA certificate hashes for Android app ${appId}.` +
            " See firebase-debug.log for more info.", {
            exit: 2,
            original: err,
        });
    }
}
exports.listAppAndroidSha = listAppAndroidSha;
async function createAppAndroidSha(projectId, appId, options) {
    try {
        const response = await apiClient.request({
            method: "POST",
            path: `/projects/${projectId}/androidApps/${appId}/sha`,
            body: options,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
        });
        const shaCertificate = response.body;
        return shaCertificate;
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to create SHA certificate hash for Android app ${appId}. See firebase-debug.log for more info.`, {
            exit: 2,
            original: err,
        });
    }
}
exports.createAppAndroidSha = createAppAndroidSha;
async function deleteAppAndroidSha(projectId, appId, shaId) {
    try {
        await apiClient.request({
            method: "DELETE",
            path: `/projects/${projectId}/androidApps/${appId}/sha/${shaId}`,
            timeout: CREATE_APP_API_REQUEST_TIMEOUT_MILLIS,
        });
    }
    catch (err) {
        logger_1.logger.debug(err.message);
        throw new error_1.FirebaseError(`Failed to delete SHA certificate hash for Android app ${appId}. See firebase-debug.log for more info.`, {
            exit: 2,
            original: err,
        });
    }
}
exports.deleteAppAndroidSha = deleteAppAndroidSha;
async function findIntelligentPathForIOS(appDir, options) {
    const currentFiles = await fs.readdir(appDir, { withFileTypes: true });
    for (let i = 0; i < currentFiles.length; i++) {
        const dirent = currentFiles[i];
        const xcodeStr = ".xcodeproj";
        const file = dirent.name;
        if (file.endsWith(xcodeStr)) {
            return path.join(appDir, file.substring(0, file.length - xcodeStr.length));
        }
        else if (file === "Info.plist" ||
            file === "Assets.xcassets" ||
            (dirent.isDirectory() && file === "Preview Content")) {
            return appDir;
        }
    }
    let outputPath = null;
    if (!options.nonInteractive) {
        outputPath = await (0, prompt_1.promptForDirectory)({
            config: options.config,
            message: `We weren't able to automatically determine the output directory. Where would you like to output your config file?`,
            relativeTo: appDir,
        });
    }
    if (!outputPath) {
        throw new Error("We weren't able to automatically determine the output directory.");
    }
    return outputPath;
}
exports.findIntelligentPathForIOS = findIntelligentPathForIOS;
async function findIntelligentPathForAndroid(appDir, options) {
    const paths = appDir.split("/");
    if (paths[0] === "app") {
        return appDir;
    }
    else {
        const currentFiles = await fs.readdir(appDir, { withFileTypes: true });
        const dirs = [];
        for (const fileOrDir of currentFiles) {
            if (fileOrDir.isDirectory()) {
                if (fileOrDir.name !== "gradle") {
                    dirs.push(fileOrDir.name);
                }
                if (fileOrDir.name === "src") {
                    return appDir;
                }
            }
        }
        let module = path.join(appDir, "app");
        if (dirs.length === 1 && dirs[0] === "app") {
            return module;
        }
        if (!options.nonInteractive) {
            module = await (0, prompt_1.promptForDirectory)({
                config: options.config,
                message: `We weren't able to automatically determine the output directory. Where would you like to output your config file?`,
            });
        }
        return module;
    }
}
exports.findIntelligentPathForAndroid = findIntelligentPathForAndroid;
