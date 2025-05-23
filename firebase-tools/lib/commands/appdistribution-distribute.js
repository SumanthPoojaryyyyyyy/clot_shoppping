"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const fs = require("fs-extra");
const command_1 = require("../command");
const utils = require("../utils");
const requireAuth_1 = require("../requireAuth");
const client_1 = require("../appdistribution/client");
const types_1 = require("../appdistribution/types");
const error_1 = require("../error");
const distribution_1 = require("../appdistribution/distribution");
const options_parser_util_1 = require("../appdistribution/options-parser-util");
const TEST_MAX_POLLING_RETRIES = 40;
const TEST_POLLING_INTERVAL_MILLIS = 30000;
function getReleaseNotes(releaseNotes, releaseNotesFile) {
    if (releaseNotes) {
        return releaseNotes.replace(/\\n/g, "\n");
    }
    else if (releaseNotesFile) {
        (0, options_parser_util_1.ensureFileExists)(releaseNotesFile);
        return fs.readFileSync(releaseNotesFile, "utf8");
    }
    return "";
}
exports.command = new command_1.Command("appdistribution:distribute <release-binary-file>")
    .description("upload a release binary and optionally distribute it to testers and run automated tests")
    .option("--app <app_id>", "the app id of your Firebase app")
    .option("--release-notes <string>", "release notes to include")
    .option("--release-notes-file <file>", "path to file with release notes")
    .option("--testers <string>", "a comma-separated list of tester emails to distribute to")
    .option("--testers-file <file>", "path to file with a comma- or newline-separated list of tester emails to distribute to")
    .option("--groups <string>", "a comma-separated list of group aliases to distribute to")
    .option("--groups-file <file>", "path to file with a comma- or newline-separated list of group aliases to distribute to")
    .option("--test-devices <string>", "semicolon-separated list of devices to run automated tests on, in the format 'model=<model-id>,version=<os-version-id>,locale=<locale>,orientation=<orientation>'. Run 'gcloud firebase test android|ios models list' to see available devices. Note: This feature is in beta.")
    .option("--test-devices-file <string>", "path to file containing a list of semicolon- or newline-separated devices to run automated tests on, in the format 'model=<model-id>,version=<os-version-id>,locale=<locale>,orientation=<orientation>'. Run 'gcloud firebase test android|ios models list' to see available devices. Note: This feature is in beta.")
    .option("--test-username <string>", "username for automatic login")
    .option("--test-password <string>", "password for automatic login. If using a real password, use --test-password-file instead to avoid putting sensitive info in history and logs.")
    .option("--test-password-file <string>", "path to file containing password for automatic login")
    .option("--test-username-resource <string>", "resource name for the username field for automatic login")
    .option("--test-password-resource <string>", "resource name for the password field for automatic login")
    .option("--test-non-blocking", "run automated tests without waiting for them to complete. Visit the Firebase console for the test results.")
    .option("--test-case-ids <string>", "a comma-separated list of test case IDs.")
    .option("--test-case-ids-file <file>", "path to file with a comma- or newline-separated list of test case IDs.")
    .before(requireAuth_1.requireAuth)
    .action(async (file, options) => {
    const appName = (0, options_parser_util_1.getAppName)(options);
    const distribution = new distribution_1.Distribution(file);
    const releaseNotes = getReleaseNotes(options.releaseNotes, options.releaseNotesFile);
    const testers = (0, options_parser_util_1.parseIntoStringArray)(options.testers, options.testersFile);
    const groups = (0, options_parser_util_1.parseIntoStringArray)(options.groups, options.groupsFile);
    const testCases = (0, options_parser_util_1.parseIntoStringArray)(options.testCaseIds, options.testCaseIdsFile);
    const testDevices = (0, options_parser_util_1.parseTestDevices)(options.testDevices, options.testDevicesFile);
    if (testCases.length && (options.testUsernameResource || options.testPasswordResource)) {
        throw new error_1.FirebaseError("Password and username resource names are not supported for the testing agent.");
    }
    const loginCredential = (0, options_parser_util_1.getLoginCredential)({
        username: options.testUsername,
        password: options.testPassword,
        passwordFile: options.testPasswordFile,
        usernameResourceName: options.testUsernameResource,
        passwordResourceName: options.testPasswordResource,
    });
    const requests = new client_1.AppDistributionClient();
    let aabInfo;
    if (distribution.distributionFileType() === distribution_1.DistributionFileType.AAB) {
        try {
            aabInfo = await requests.getAabInfo(appName);
        }
        catch (err) {
            if ((0, error_1.getErrStatus)(err) === 404) {
                throw new error_1.FirebaseError(`App Distribution could not find your app ${options.app}. ` +
                    `Make sure to onboard your app by pressing the "Get started" ` +
                    "button on the App Distribution page in the Firebase console: " +
                    "https://console.firebase.google.com/project/_/appdistribution", { exit: 1 });
            }
            throw new error_1.FirebaseError(`failed to determine AAB info. ${(0, error_1.getErrMsg)(err)}`, { exit: 1 });
        }
        if (aabInfo.integrationState !== types_1.IntegrationState.INTEGRATED &&
            aabInfo.integrationState !== types_1.IntegrationState.AAB_STATE_UNAVAILABLE) {
            switch (aabInfo.integrationState) {
                case types_1.IntegrationState.PLAY_ACCOUNT_NOT_LINKED: {
                    throw new error_1.FirebaseError("This project is not linked to a Google Play account.");
                }
                case types_1.IntegrationState.APP_NOT_PUBLISHED: {
                    throw new error_1.FirebaseError('"This app is not published in the Google Play console.');
                }
                case types_1.IntegrationState.NO_APP_WITH_GIVEN_BUNDLE_ID_IN_PLAY_ACCOUNT: {
                    throw new error_1.FirebaseError("App with matching package name does not exist in Google Play.");
                }
                case types_1.IntegrationState.PLAY_IAS_TERMS_NOT_ACCEPTED: {
                    throw new error_1.FirebaseError("You must accept the Play Internal App Sharing (IAS) terms to upload AABs.");
                }
                default: {
                    throw new error_1.FirebaseError("App Distribution failed to process the AAB: " + aabInfo.integrationState);
                }
            }
        }
    }
    utils.logBullet("uploading binary...");
    let releaseName;
    try {
        const operationName = await requests.uploadRelease(appName, distribution);
        const uploadResponse = await requests.pollUploadStatus(operationName);
        const release = uploadResponse.release;
        switch (uploadResponse.result) {
            case types_1.UploadReleaseResult.RELEASE_CREATED:
                utils.logSuccess(`uploaded new release ${release.displayVersion} (${release.buildVersion}) successfully!`);
                break;
            case types_1.UploadReleaseResult.RELEASE_UPDATED:
                utils.logSuccess(`uploaded update to existing release ${release.displayVersion} (${release.buildVersion}) successfully!`);
                break;
            case types_1.UploadReleaseResult.RELEASE_UNMODIFIED:
                utils.logSuccess(`re-uploaded already existing release ${release.displayVersion} (${release.buildVersion}) successfully!`);
                break;
            default:
                utils.logSuccess(`uploaded release ${release.displayVersion} (${release.buildVersion}) successfully!`);
        }
        utils.logSuccess(`View this release in the Firebase console: ${release.firebaseConsoleUri}`);
        utils.logSuccess(`Share this release with testers who have access: ${release.testingUri}`);
        utils.logSuccess(`Download the release binary (link expires in 1 hour): ${release.binaryDownloadUri}`);
        releaseName = uploadResponse.release.name;
    }
    catch (err) {
        if ((0, error_1.getErrStatus)(err) === 404) {
            throw new error_1.FirebaseError(`App Distribution could not find your app ${options.app}. ` +
                `Make sure to onboard your app by pressing the "Get started" ` +
                "button on the App Distribution page in the Firebase console: " +
                "https://console.firebase.google.com/project/_/appdistribution", { exit: 1 });
        }
        throw new error_1.FirebaseError(`Failed to upload release. ${(0, error_1.getErrMsg)(err)}`, { exit: 1 });
    }
    if (aabInfo && !aabInfo.testCertificate) {
        aabInfo = await requests.getAabInfo(appName);
        if (aabInfo.testCertificate) {
            utils.logBullet("After you upload an AAB for the first time, App Distribution " +
                "generates a new test certificate. All AAB uploads are re-signed with this test " +
                "certificate. Use the certificate fingerprints below to register your app " +
                "signing key with API providers, such as Google Sign-In and Google Maps.\n" +
                `MD-1 certificate fingerprint: ${aabInfo.testCertificate.hashMd5}\n` +
                `SHA-1 certificate fingerprint: ${aabInfo.testCertificate.hashSha1}\n` +
                `SHA-256 certificate fingerprint: ${aabInfo.testCertificate.hashSha256}`);
        }
    }
    await requests.updateReleaseNotes(releaseName, releaseNotes);
    await requests.distribute(releaseName, testers, groups);
    if (testDevices.length) {
        utils.logBullet("starting automated test (note: this feature is in beta)");
        const releaseTestPromises = [];
        if (!testCases.length) {
            releaseTestPromises.push(requests.createReleaseTest(releaseName, testDevices, loginCredential));
        }
        else {
            for (const testCaseId of testCases) {
                releaseTestPromises.push(requests.createReleaseTest(releaseName, testDevices, loginCredential, `${appName}/testCases/${testCaseId}`));
            }
        }
        const releaseTests = await Promise.all(releaseTestPromises);
        utils.logSuccess(`${releaseTests.length} release test(s) started successfully`);
        if (!options.testNonBlocking) {
            await awaitTestResults(releaseTests, requests);
        }
    }
});
async function awaitTestResults(releaseTests, requests) {
    const releaseTestNames = new Set(releaseTests.map((rt) => rt.name));
    for (let i = 0; i < TEST_MAX_POLLING_RETRIES; i++) {
        utils.logBullet(`${releaseTestNames.size} automated test results are pending...`);
        await delay(TEST_POLLING_INTERVAL_MILLIS);
        for (const releaseTestName of releaseTestNames) {
            const releaseTest = await requests.getReleaseTest(releaseTestName);
            if (releaseTest.deviceExecutions.every((e) => e.state === "PASSED")) {
                releaseTestNames.delete(releaseTestName);
                if (releaseTestNames.size === 0) {
                    utils.logSuccess("Automated test(s) passed!");
                    return;
                }
                else {
                    continue;
                }
            }
            for (const execution of releaseTest.deviceExecutions) {
                switch (execution.state) {
                    case "PASSED":
                    case "IN_PROGRESS":
                        continue;
                    case "FAILED":
                        throw new error_1.FirebaseError(`Automated test failed for ${deviceToString(execution.device)}: ${execution.failedReason}`, { exit: 1 });
                    case "INCONCLUSIVE":
                        throw new error_1.FirebaseError(`Automated test inconclusive for ${deviceToString(execution.device)}: ${execution.inconclusiveReason}`, { exit: 1 });
                    default:
                        throw new error_1.FirebaseError(`Unsupported automated test state for ${deviceToString(execution.device)}: ${execution.state}`, { exit: 1 });
                }
            }
        }
    }
    throw new error_1.FirebaseError("It took longer than expected to run your test(s), please try again.", {
        exit: 1,
    });
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function deviceToString(device) {
    return `${device.model} (${device.version}/${device.orientation}/${device.locale})`;
}
