"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initIndexes = void 0;
const clc = require("colorette");
const error_1 = require("../../../error");
const api = require("../../../firestore/api");
const fsutils = require("../../../fsutils");
const prompt_1 = require("../../../prompt");
const logger_1 = require("../../../logger");
const templates_1 = require("../../../templates");
const indexes = new api.FirestoreApi();
const INDEXES_TEMPLATE = (0, templates_1.readTemplateSync)("init/firestore/firestore.indexes.json");
function initIndexes(setup, config) {
    logger_1.logger.info();
    logger_1.logger.info("Firestore indexes allow you to perform complex queries while");
    logger_1.logger.info("maintaining performance that scales with the size of the result");
    logger_1.logger.info("set. You can keep index definitions in your project directory");
    logger_1.logger.info("and publish them with " + clc.bold("firebase deploy") + ".");
    logger_1.logger.info();
    return (0, prompt_1.prompt)(setup.config.firestore, [
        {
            type: "input",
            name: "indexes",
            message: "What file should be used for Firestore indexes?",
            default: "firestore.indexes.json",
        },
    ])
        .then(() => {
        const filename = setup.config.firestore.indexes;
        if (fsutils.fileExistsSync(filename)) {
            const msg = "File " +
                clc.bold(filename) +
                " already exists." +
                " Do you want to overwrite it with the Firestore Indexes from the Firebase Console?";
            return (0, prompt_1.promptOnce)({
                type: "confirm",
                message: msg,
                default: false,
            });
        }
        return Promise.resolve(true);
    })
        .then((overwrite) => {
        if (!overwrite) {
            return Promise.resolve();
        }
        if (!setup.projectId) {
            return config.writeProjectFile(setup.config.firestore.indexes, INDEXES_TEMPLATE);
        }
        return getIndexesFromConsole(setup.projectId, setup.databaseId).then((contents) => {
            return config.writeProjectFile(setup.config.firestore.indexes, contents);
        });
    });
}
exports.initIndexes = initIndexes;
function getIndexesFromConsole(projectId, databaseId) {
    const indexesPromise = indexes.listIndexes(projectId, databaseId);
    const fieldOverridesPromise = indexes.listFieldOverrides(projectId, databaseId);
    return Promise.all([indexesPromise, fieldOverridesPromise])
        .then((res) => {
        return indexes.makeIndexSpec(res[0], res[1]);
    })
        .catch((e) => {
        if (e.message.indexOf("is not a Cloud Firestore enabled project") >= 0) {
            return INDEXES_TEMPLATE;
        }
        throw new error_1.FirebaseError("Error fetching Firestore indexes", {
            original: e,
        });
    });
}
