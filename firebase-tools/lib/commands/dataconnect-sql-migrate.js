"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const command_1 = require("../command");
const projectUtils_1 = require("../projectUtils");
const fileUtils_1 = require("../dataconnect/fileUtils");
const error_1 = require("../error");
const schemaMigration_1 = require("../dataconnect/schemaMigration");
const requireAuth_1 = require("../requireAuth");
const requirePermissions_1 = require("../requirePermissions");
const ensureApis_1 = require("../dataconnect/ensureApis");
const utils_1 = require("../utils");
exports.command = new command_1.Command("dataconnect:sql:migrate [serviceId]")
    .description("migrate your CloudSQL database's schema to match your local Data Connect schema")
    .before(requirePermissions_1.requirePermissions, [
    "firebasedataconnect.services.list",
    "firebasedataconnect.schemas.list",
    "firebasedataconnect.schemas.update",
    "cloudsql.instances.connect",
])
    .before(requireAuth_1.requireAuth)
    .withForce("execute any required database changes without prompting")
    .action(async (serviceId, options) => {
    var _a, _b;
    const projectId = (0, projectUtils_1.needProjectId)(options);
    await (0, ensureApis_1.ensureApis)(projectId);
    const serviceInfo = await (0, fileUtils_1.pickService)(projectId, options.config, serviceId);
    const instanceId = (_a = serviceInfo.dataConnectYaml.schema.datasource.postgresql) === null || _a === void 0 ? void 0 : _a.cloudSql.instanceId;
    if (!instanceId) {
        throw new error_1.FirebaseError("dataconnect.yaml is missing field schema.datasource.postgresql.cloudsql.instanceId");
    }
    const diffs = await (0, schemaMigration_1.migrateSchema)({
        options,
        schema: serviceInfo.schema,
        validateOnly: true,
        schemaValidation: (_b = serviceInfo.dataConnectYaml.schema.datasource.postgresql) === null || _b === void 0 ? void 0 : _b.schemaValidation,
    });
    if (diffs.length) {
        (0, utils_1.logLabeledSuccess)("dataconnect", `Database schema sucessfully migrated! Run 'firebase deploy' to deploy your new schema to your Data Connect service.`);
    }
    else {
        (0, utils_1.logLabeledSuccess)("dataconnect", "Database schema is already up to date!");
    }
    return { projectId, serviceId, diffs };
});
