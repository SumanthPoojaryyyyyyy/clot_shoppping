"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printTriggerUrls = exports.release = void 0;
const clc = require("colorette");
const logger_1 = require("../../../logger");
const functional_1 = require("../../../functional");
const utils = require("../../../utils");
const backend = require("../backend");
const planner = require("./planner");
const fabricator = require("./fabricator");
const reporter = require("./reporter");
const executor = require("./executor");
const prompts = require("../prompts");
const functionsConfig_1 = require("../../../functionsConfig");
const functionsDeployHelper_1 = require("../functionsDeployHelper");
const error_1 = require("../../../error");
const getProjectNumber_1 = require("../../../getProjectNumber");
const extensions_1 = require("../../extensions");
const artifacts = require("../../../functions/artifacts");
async function release(context, options, payload) {
    if (context.extensions && payload.extensions) {
        await (0, extensions_1.release)(context.extensions, options, payload.extensions);
    }
    if (!context.config) {
        return;
    }
    if (!payload.functions) {
        return;
    }
    if (!context.sources) {
        return;
    }
    let plan = {};
    for (const [codebase, { wantBackend, haveBackend }] of Object.entries(payload.functions)) {
        plan = Object.assign(Object.assign({}, plan), planner.createDeploymentPlan({
            codebase,
            wantBackend,
            haveBackend,
            filters: context.filters,
        }));
    }
    const fnsToDelete = Object.values(plan)
        .map((regionalChanges) => regionalChanges.endpointsToDelete)
        .reduce(functional_1.reduceFlat, []);
    const shouldDelete = await prompts.promptForFunctionDeletion(fnsToDelete, options);
    if (!shouldDelete) {
        for (const change of Object.values(plan)) {
            change.endpointsToDelete = [];
        }
    }
    const fnsToUpdate = Object.values(plan)
        .map((regionalChanges) => regionalChanges.endpointsToUpdate)
        .reduce(functional_1.reduceFlat, []);
    const fnsToUpdateSafe = await prompts.promptForUnsafeMigration(fnsToUpdate, options);
    for (const key of Object.keys(plan)) {
        plan[key].endpointsToUpdate = [];
    }
    for (const eu of fnsToUpdateSafe) {
        const e = eu.endpoint;
        const key = `${e.codebase || ""}-${e.region}-${e.availableMemoryMb || "default"}`;
        plan[key].endpointsToUpdate.push(eu);
    }
    const throttlerOptions = {
        retries: 30,
        backoff: 20000,
        concurrency: 40,
        maxBackoff: 100000,
    };
    const fab = new fabricator.Fabricator({
        functionExecutor: new executor.QueueExecutor(throttlerOptions),
        executor: new executor.QueueExecutor(throttlerOptions),
        sources: context.sources,
        appEngineLocation: (0, functionsConfig_1.getAppEngineLocation)(context.firebaseConfig),
        projectNumber: options.projectNumber || (await (0, getProjectNumber_1.getProjectNumber)(context.projectId)),
    });
    const summary = await fab.applyPlan(plan);
    await reporter.logAndTrackDeployStats(summary, context);
    reporter.printErrors(summary);
    const wantBackend = backend.merge(...Object.values(payload.functions).map((p) => p.wantBackend));
    printTriggerUrls(wantBackend);
    await setupArtifactCleanupPolicies(options, options.projectId, Object.keys(wantBackend.endpoints));
    const allErrors = summary.results.filter((r) => r.error).map((r) => r.error);
    if (allErrors.length) {
        const opts = allErrors.length === 1 ? { original: allErrors[0] } : { children: allErrors };
        logger_1.logger.debug("Functions deploy failed.");
        for (const error of allErrors) {
            logger_1.logger.debug(JSON.stringify(error, null, 2));
        }
        throw new error_1.FirebaseError("There was an error deploying functions", Object.assign(Object.assign({}, opts), { exit: 2 }));
    }
}
exports.release = release;
function printTriggerUrls(results) {
    const httpsFunctions = backend.allEndpoints(results).filter(backend.isHttpsTriggered);
    if (httpsFunctions.length === 0) {
        return;
    }
    for (const httpsFunc of httpsFunctions) {
        if (!httpsFunc.uri) {
            logger_1.logger.debug("Not printing URL for HTTPS function. Typically this means it didn't match a filter or we failed deployment");
            continue;
        }
        logger_1.logger.info(clc.bold("Function URL"), `(${(0, functionsDeployHelper_1.getFunctionLabel)(httpsFunc)}):`, httpsFunc.uri);
    }
}
exports.printTriggerUrls = printTriggerUrls;
async function setupArtifactCleanupPolicies(options, projectId, locations) {
    if (locations.length === 0) {
        return;
    }
    const { locationsToSetup, locationsWithErrors: locationsWithCheckErrors } = await artifacts.checkCleanupPolicy(projectId, locations);
    if (locationsToSetup.length === 0) {
        return;
    }
    const daysToKeep = await prompts.promptForCleanupPolicyDays(options, locationsToSetup);
    utils.logLabeledBullet("functions", `Configuring cleanup policy for ${locationsToSetup.length > 1 ? "repositories" : "repository"} in ${locationsToSetup.join(", ")}. ` +
        `Images older than ${daysToKeep} days will be automatically deleted.`);
    const { locationsWithPolicy, locationsWithErrors: locationsWithSetupErrors } = await artifacts.setCleanupPolicies(projectId, locationsToSetup, daysToKeep);
    utils.logLabeledBullet("functions", `Configured cleanup policy for ${locationsWithPolicy.length > 1 ? "repositories" : "repository"} in ${locationsToSetup.join(", ")}.`);
    const locationsWithErrors = [...locationsWithCheckErrors, ...locationsWithSetupErrors];
    if (locationsWithErrors.length > 0) {
        utils.logLabeledWarning("functions", `Failed to set up cleanup policy for repositories in ${locationsWithErrors.length > 1 ? "regions" : "region"} ` +
            `${locationsWithErrors.join(", ")}.` +
            "This could result in a small monthly bill as container images accumulate over time.");
        throw new error_1.FirebaseError(`Functions successfully deployed but could not set up cleanup policy in ` +
            `${locationsWithErrors.length > 1 ? "regions" : "region"} ${locationsWithErrors.join(", ")}.` +
            `Pass the --force option to automatically set up a cleanup policy or` +
            "run 'firebase functions:artifacts:setpolicy' to set up a cleanup policy to automatically delete old images.");
    }
}
