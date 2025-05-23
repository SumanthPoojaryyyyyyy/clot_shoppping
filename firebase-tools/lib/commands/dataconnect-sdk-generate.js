"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const clc = require("colorette");
const command_1 = require("../command");
const dataconnectEmulator_1 = require("../emulator/dataconnectEmulator");
const projectUtils_1 = require("../projectUtils");
const load_1 = require("../dataconnect/load");
const fileUtils_1 = require("../dataconnect/fileUtils");
const logger_1 = require("../logger");
const auth_1 = require("../auth");
exports.command = new command_1.Command("dataconnect:sdk:generate")
    .description("generate typed SDKs for your Data Connect connectors")
    .option("--watch", "watch for changes to your connector GQL files and regenerate your SDKs when updates occur")
    .action(async (options) => {
    const projectId = (0, projectUtils_1.needProjectId)(options);
    const services = (0, fileUtils_1.readFirebaseJson)(options.config);
    for (const service of services) {
        const configDir = service.source;
        const serviceInfo = await (0, load_1.load)(projectId, options.config, configDir);
        const hasGeneratables = serviceInfo.connectorInfo.some((c) => {
            var _a, _b, _c, _d;
            return (((_a = c.connectorYaml.generate) === null || _a === void 0 ? void 0 : _a.javascriptSdk) ||
                ((_b = c.connectorYaml.generate) === null || _b === void 0 ? void 0 : _b.kotlinSdk) ||
                ((_c = c.connectorYaml.generate) === null || _c === void 0 ? void 0 : _c.swiftSdk) ||
                ((_d = c.connectorYaml.generate) === null || _d === void 0 ? void 0 : _d.dartSdk));
        });
        if (!hasGeneratables) {
            logger_1.logger.warn("No generated SDKs have been declared in connector.yaml files.");
            logger_1.logger.warn(`Run ${clc.bold("firebase init dataconnect:sdk")} to configure a generated SDK.`);
            logger_1.logger.warn(`See https://firebase.google.com/docs/data-connect/web-sdk for more details of how to configure generated SDKs.`);
            return;
        }
        for (const conn of serviceInfo.connectorInfo) {
            const account = (0, auth_1.getProjectDefaultAccount)(options.projectRoot);
            const output = await dataconnectEmulator_1.DataConnectEmulator.generate({
                configDir,
                connectorId: conn.connectorYaml.connectorId,
                watch: options.watch,
                account,
            });
            logger_1.logger.info(output);
            logger_1.logger.info(`Generated SDKs for ${conn.connectorYaml.connectorId}`);
        }
    }
});
