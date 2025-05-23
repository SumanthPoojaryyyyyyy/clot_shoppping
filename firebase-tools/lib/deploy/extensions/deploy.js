"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploy = void 0;
const tasks = require("./tasks");
const queue_1 = require("../../throttler/queue");
const error_1 = require("../../error");
const errors_1 = require("./errors");
const projectUtils_1 = require("../../projectUtils");
const provisioningHelper_1 = require("../../extensions/provisioningHelper");
const secrets_1 = require("./secrets");
const validate_1 = require("./validate");
async function deploy(context, options, payload) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const projectId = (0, projectUtils_1.needProjectId)(options);
    await (0, validate_1.checkBilling)(projectId, options.nonInteractive);
    await (0, provisioningHelper_1.bulkCheckProductsProvisioned)(projectId, [
        ...((_a = payload.instancesToCreate) !== null && _a !== void 0 ? _a : []),
        ...((_b = payload.instancesToUpdate) !== null && _b !== void 0 ? _b : []),
        ...((_c = payload.instancesToConfigure) !== null && _c !== void 0 ? _c : []),
    ]);
    if (context.have) {
        await (0, secrets_1.handleSecretParams)(payload, context.have, options.nonInteractive);
    }
    const errorHandler = new errors_1.ErrorHandler();
    const validationQueue = new queue_1.default({
        retries: 5,
        concurrency: 5,
        handler: tasks.extensionsDeploymentHandler(errorHandler),
    });
    for (const create of (_e = (_d = payload.instancesToCreate) === null || _d === void 0 ? void 0 : _d.filter((i) => !!i.ref)) !== null && _e !== void 0 ? _e : []) {
        const task = tasks.createExtensionInstanceTask(projectId, create, true);
        void validationQueue.run(task);
    }
    for (const update of (_g = (_f = payload.instancesToUpdate) === null || _f === void 0 ? void 0 : _f.filter((i) => !!i.ref)) !== null && _g !== void 0 ? _g : []) {
        const task = tasks.updateExtensionInstanceTask(projectId, update, true);
        void validationQueue.run(task);
    }
    for (const configure of (_j = (_h = payload.instancesToConfigure) === null || _h === void 0 ? void 0 : _h.filter((i) => !!i.ref)) !== null && _j !== void 0 ? _j : []) {
        const task = tasks.configureExtensionInstanceTask(projectId, configure, true);
        void validationQueue.run(task);
    }
    const validationPromise = validationQueue.wait();
    validationQueue.process();
    validationQueue.close();
    await validationPromise;
    if (errorHandler.hasErrors()) {
        errorHandler.print();
        throw new error_1.FirebaseError(`Extensions deployment failed validation. No changes have been made to the Extension instances on ${projectId}`);
    }
}
exports.deploy = deploy;
