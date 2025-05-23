"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUpdateReason = exports.provisionCloudSql = void 0;
const cloudSqlAdminClient = require("../gcp/cloudsql/cloudsqladmin");
const utils = require("../utils");
const checkIam_1 = require("./checkIam");
const utils_1 = require("../utils");
const logger_1 = require("../logger");
const GOOGLE_ML_INTEGRATION_ROLE = "roles/aiplatform.user";
const freeTrial_1 = require("./freeTrial");
const error_1 = require("../error");
async function provisionCloudSql(args) {
    let connectionName = "";
    const { projectId, locationId, instanceId, databaseId, configYamlPath, enableGoogleMlIntegration, waitForCreation, silent, dryRun, } = args;
    try {
        const existingInstance = await cloudSqlAdminClient.getInstance(projectId, instanceId);
        silent || utils.logLabeledBullet("dataconnect", `Found existing instance ${instanceId}.`);
        connectionName = (existingInstance === null || existingInstance === void 0 ? void 0 : existingInstance.connectionName) || "";
        const why = getUpdateReason(existingInstance, enableGoogleMlIntegration);
        if (why) {
            const cta = dryRun
                ? `It will be updated on your next deploy.`
                : `Updating instance. This may take a few minutes...`;
            silent ||
                utils.logLabeledBullet("dataconnect", `Instance ${instanceId} settings not compatible with Firebase Data Connect. ` + cta + why);
            if (!dryRun) {
                await (0, utils_1.promiseWithSpinner)(() => cloudSqlAdminClient.updateInstanceForDataConnect(existingInstance, enableGoogleMlIntegration), "Updating your instance...");
                silent || utils.logLabeledBullet("dataconnect", "Instance updated");
            }
        }
    }
    catch (err) {
        if (err.status !== 404) {
            throw err;
        }
        cmekWarning();
        const cta = dryRun ? "It will be created on your next deploy" : "Creating it now.";
        silent ||
            utils.logLabeledBullet("dataconnect", `CloudSQL instance '${instanceId}' not found.` +
                cta +
                `\nThis instance is provided under the terms of the Data Connect no-cost trial ${(0, freeTrial_1.freeTrialTermsLink)()}` +
                `\nMonitor the progress at ${cloudSqlAdminClient.instanceConsoleLink(projectId, instanceId)}`);
        if (!dryRun) {
            try {
                const newInstance = await (0, utils_1.promiseWithSpinner)(() => cloudSqlAdminClient.createInstance(projectId, locationId, instanceId, enableGoogleMlIntegration, waitForCreation), "Creating your instance...");
                if (newInstance) {
                    silent || utils.logLabeledBullet("dataconnect", "Instance created");
                    connectionName = (newInstance === null || newInstance === void 0 ? void 0 : newInstance.connectionName) || "";
                }
                else {
                    silent ||
                        utils.logLabeledBullet("dataconnect", "Cloud SQL instance creation started - it should be ready shortly. Database and users will be created on your next deploy.");
                    return connectionName;
                }
            }
            catch (err) {
                if (await (0, freeTrial_1.isFreeTrialError)(err, projectId)) {
                    const freeTrialInstanceId = await (0, freeTrial_1.getFreeTrialInstanceId)(projectId);
                    (0, freeTrial_1.printFreeTrialUnavailable)(projectId, configYamlPath, freeTrialInstanceId);
                    throw new error_1.FirebaseError("No-cost Cloud SQL trial has already been used on this project.");
                }
                throw err;
            }
        }
    }
    try {
        await cloudSqlAdminClient.getDatabase(projectId, instanceId, databaseId);
        silent || utils.logLabeledBullet("dataconnect", `Found existing database ${databaseId}.`);
    }
    catch (err) {
        if (err.status === 404) {
            if (dryRun) {
                silent ||
                    utils.logLabeledBullet("dataconnect", `Database ${databaseId} not found. It will be created on your next deploy.`);
            }
            else {
                silent ||
                    utils.logLabeledBullet("dataconnect", `Database ${databaseId} not found, creating it now...`);
                await cloudSqlAdminClient.createDatabase(projectId, instanceId, databaseId);
                silent || utils.logLabeledBullet("dataconnect", `Database ${databaseId} created.`);
            }
        }
        else {
            logger_1.logger.debug(`Unexpected error from CloudSQL: ${err}`);
            silent || utils.logLabeledWarning("dataconnect", `Database ${databaseId} is not accessible.`);
        }
    }
    if (enableGoogleMlIntegration && !dryRun) {
        await (0, checkIam_1.grantRolesToCloudSqlServiceAccount)(projectId, instanceId, [GOOGLE_ML_INTEGRATION_ROLE]);
    }
    return connectionName;
}
exports.provisionCloudSql = provisionCloudSql;
function getUpdateReason(instance, requireGoogleMlIntegration) {
    var _a, _b, _c, _d;
    let reason = "";
    const settings = instance.settings;
    if (!((_a = settings.ipConfiguration) === null || _a === void 0 ? void 0 : _a.ipv4Enabled)) {
        reason += "\n - to enable public IP.";
    }
    if (requireGoogleMlIntegration) {
        if (!settings.enableGoogleMlIntegration) {
            reason += "\n - to enable Google ML integration.";
        }
        if (!((_b = settings.databaseFlags) === null || _b === void 0 ? void 0 : _b.some((f) => f.name === "cloudsql.enable_google_ml_integration" && f.value === "on"))) {
            reason += "\n - to enable Google ML integration database flag.";
        }
    }
    const isIamEnabled = (_d = (_c = settings.databaseFlags) === null || _c === void 0 ? void 0 : _c.some((f) => f.name === "cloudsql.iam_authentication" && f.value === "on")) !== null && _d !== void 0 ? _d : false;
    if (!isIamEnabled) {
        reason += "\n - to enable IAM authentication database flag.";
    }
    return reason;
}
exports.getUpdateReason = getUpdateReason;
function cmekWarning() {
    const message = "The no-cost Cloud SQL trial instance does not support customer managed encryption keys.\n" +
        "If you'd like to use a CMEK to encrypt your data, first create a CMEK encrypted instance (https://cloud.google.com/sql/docs/postgres/configure-cmek#createcmekinstance).\n" +
        "Then, edit your `dataconnect.yaml` file to use the encrypted instance and redeploy.";
    utils.logLabeledWarning("dataconnect", message);
}
