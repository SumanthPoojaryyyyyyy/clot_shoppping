"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDNSCompatibleId = exports.actuate = exports.doSetup = void 0;
const path_1 = require("path");
const clc = require("colorette");
const fs = require("fs-extra");
const prompt_1 = require("../../../prompt");
const provisionCloudSql_1 = require("../../../dataconnect/provisionCloudSql");
const freeTrial_1 = require("../../../dataconnect/freeTrial");
const cloudsql = require("../../../gcp/cloudsql/cloudsqladmin");
const ensureApis_1 = require("../../../dataconnect/ensureApis");
const client_1 = require("../../../dataconnect/client");
const types_1 = require("../../../dataconnect/types");
const names_1 = require("../../../dataconnect/names");
const logger_1 = require("../../../logger");
const templates_1 = require("../../../templates");
const utils_1 = require("../../../utils");
const cloudbilling_1 = require("../../../gcp/cloudbilling");
const sdk = require("./sdk");
const fileUtils_1 = require("../../../dataconnect/fileUtils");
const DATACONNECT_YAML_TEMPLATE = (0, templates_1.readTemplateSync)("init/dataconnect/dataconnect.yaml");
const CONNECTOR_YAML_TEMPLATE = (0, templates_1.readTemplateSync)("init/dataconnect/connector.yaml");
const SCHEMA_TEMPLATE = (0, templates_1.readTemplateSync)("init/dataconnect/schema.gql");
const QUERIES_TEMPLATE = (0, templates_1.readTemplateSync)("init/dataconnect/queries.gql");
const MUTATIONS_TEMPLATE = (0, templates_1.readTemplateSync)("init/dataconnect/mutations.gql");
const serviceEnvVar = () => (0, utils_1.envOverride)("FDC_SERVICE", "");
const emptyConnector = {
    id: "default",
    path: "./connector",
    files: [],
};
const defaultConnector = {
    id: "default",
    path: "./connector",
    files: [
        {
            path: "queries.gql",
            content: QUERIES_TEMPLATE,
        },
        {
            path: "mutations.gql",
            content: MUTATIONS_TEMPLATE,
        },
    ],
};
const defaultSchema = { path: "schema.gql", content: SCHEMA_TEMPLATE };
async function doSetup(setup, config) {
    const isBillingEnabled = setup.projectId ? await (0, cloudbilling_1.checkBillingEnabled)(setup.projectId) : false;
    if (setup.projectId) {
        isBillingEnabled ? await (0, ensureApis_1.ensureApis)(setup.projectId) : await (0, ensureApis_1.ensureSparkApis)(setup.projectId);
    }
    const info = await askQuestions(setup, isBillingEnabled);
    const dir = config.get("dataconnect.source", "dataconnect");
    const dataDir = config.get("emulators.dataconnect.dataDir", `${dir}/.dataconnect/pgliteData`);
    config.set("emulators.dataconnect.dataDir", dataDir);
    await actuate(setup, config, info);
    const cwdPlatformGuess = await (0, fileUtils_1.getPlatformFromFolder)(process.cwd());
    if (cwdPlatformGuess !== types_1.Platform.NONE) {
        await sdk.doSetup(setup, config);
    }
    else {
        (0, utils_1.logBullet)(`If you'd like to add the generated SDK to your app later, run ${clc.bold("firebase init dataconnect:sdk")}`);
    }
    if (setup.projectId && !isBillingEnabled) {
        (0, utils_1.logBullet)((0, freeTrial_1.upgradeInstructions)(setup.projectId));
    }
}
exports.doSetup = doSetup;
async function askQuestions(setup, isBillingEnabled) {
    let info = {
        serviceId: "",
        locationId: "",
        cloudSqlInstanceId: "",
        isNewInstance: false,
        cloudSqlDatabase: "",
        isNewDatabase: false,
        connectors: [defaultConnector],
        schemaGql: [defaultSchema],
        shouldProvisionCSQL: false,
    };
    info = await promptForExistingServices(setup, info, isBillingEnabled);
    const requiredConfigUnset = info.serviceId === "" ||
        info.cloudSqlInstanceId === "" ||
        info.locationId === "" ||
        info.cloudSqlDatabase === "";
    const shouldConfigureBackend = isBillingEnabled && requiredConfigUnset
        ? await (0, prompt_1.confirm)({
            message: `Would you like to configure your backend resources now?`,
            default: true,
        })
        : false;
    if (shouldConfigureBackend) {
        info = await promptForService(info);
        info = await promptForCloudSQL(setup, info);
        info.shouldProvisionCSQL = !!(setup.projectId &&
            (info.isNewInstance || info.isNewDatabase) &&
            isBillingEnabled &&
            (await (0, prompt_1.confirm)({
                message: `Would you like to provision your Cloud SQL instance and database now?${info.isNewInstance ? " This will take several minutes." : ""}.`,
                default: true,
            })));
    }
    else {
        const defaultServiceId = toDNSCompatibleId((0, path_1.basename)(process.cwd()));
        info.serviceId = info.serviceId || defaultServiceId;
        info.cloudSqlInstanceId =
            info.cloudSqlInstanceId || `${info.serviceId.toLowerCase() || "app"}-fdc`;
        info.locationId = info.locationId || `us-central1`;
        info.cloudSqlDatabase = info.cloudSqlDatabase || `fdcdb`;
    }
    return info;
}
async function actuate(setup, config, info) {
    await writeFiles(config, info);
    if (setup.projectId && info.shouldProvisionCSQL) {
        await (0, provisionCloudSql_1.provisionCloudSql)({
            projectId: setup.projectId,
            locationId: info.locationId,
            instanceId: info.cloudSqlInstanceId,
            databaseId: info.cloudSqlDatabase,
            configYamlPath: (0, path_1.join)(config.get("dataconnect.source"), "dataconnect.yaml"),
            enableGoogleMlIntegration: false,
            waitForCreation: false,
        });
    }
}
exports.actuate = actuate;
async function writeFiles(config, info) {
    const dir = config.get("dataconnect.source") || "dataconnect";
    const subbedDataconnectYaml = subDataconnectYamlValues(Object.assign(Object.assign({}, info), { connectorDirs: info.connectors.map((c) => c.path) }));
    if (!config.get("dataconnect.source")) {
        if (!info.schemaGql.length && !info.connectors.flatMap((r) => r.files).length) {
            info.schemaGql = [defaultSchema];
            info.connectors = [defaultConnector];
        }
    }
    config.set("dataconnect", { source: dir });
    await config.askWriteProjectFile((0, path_1.join)(dir, "dataconnect.yaml"), subbedDataconnectYaml, false, true);
    if (info.schemaGql.length) {
        for (const f of info.schemaGql) {
            await config.askWriteProjectFile((0, path_1.join)(dir, "schema", f.path), f.content);
        }
    }
    else {
        fs.ensureFileSync((0, path_1.join)(dir, "schema", "schema.gql"));
    }
    for (const c of info.connectors) {
        await writeConnectorFiles(config, c);
    }
}
async function writeConnectorFiles(config, connectorInfo) {
    const subbedConnectorYaml = subConnectorYamlValues({ connectorId: connectorInfo.id });
    const dir = config.get("dataconnect.source") || "dataconnect";
    await config.askWriteProjectFile((0, path_1.join)(dir, connectorInfo.path, "connector.yaml"), subbedConnectorYaml);
    for (const f of connectorInfo.files) {
        await config.askWriteProjectFile((0, path_1.join)(dir, connectorInfo.path, f.path), f.content);
    }
}
function subDataconnectYamlValues(replacementValues) {
    const replacements = {
        serviceId: "__serviceId__",
        cloudSqlDatabase: "__cloudSqlDatabase__",
        cloudSqlInstanceId: "__cloudSqlInstanceId__",
        connectorDirs: "__connectorDirs__",
        locationId: "__location__",
    };
    let replaced = DATACONNECT_YAML_TEMPLATE;
    for (const [k, v] of Object.entries(replacementValues)) {
        replaced = replaced.replace(replacements[k], JSON.stringify(v));
    }
    return replaced;
}
function subConnectorYamlValues(replacementValues) {
    const replacements = {
        connectorId: "__connectorId__",
    };
    let replaced = CONNECTOR_YAML_TEMPLATE;
    for (const [k, v] of Object.entries(replacementValues)) {
        replaced = replaced.replace(replacements[k], JSON.stringify(v));
    }
    return replaced;
}
async function promptForExistingServices(setup, info, isBillingEnabled) {
    var _a, _b, _c, _d;
    if (!setup.projectId || !isBillingEnabled) {
        return info;
    }
    const existingServices = await (0, client_1.listAllServices)(setup.projectId);
    const existingServicesAndSchemas = await Promise.all(existingServices.map(async (s) => {
        return {
            service: s,
            schema: await (0, client_1.getSchema)(s.name),
        };
    }));
    if (existingServicesAndSchemas.length) {
        let choice;
        const [serviceLocationFromEnvVar, serviceIdFromEnvVar] = serviceEnvVar().split("/");
        const serviceFromEnvVar = existingServicesAndSchemas.find((s) => {
            const serviceName = (0, names_1.parseServiceName)(s.service.name);
            return (serviceName.serviceId === serviceIdFromEnvVar &&
                serviceName.location === serviceLocationFromEnvVar);
        });
        if (serviceFromEnvVar) {
            choice = serviceFromEnvVar;
        }
        else {
            const choices = existingServicesAndSchemas.map((s) => {
                const serviceName = (0, names_1.parseServiceName)(s.service.name);
                return {
                    name: `${serviceName.location}/${serviceName.serviceId}`,
                    value: s,
                };
            });
            choices.push({ name: "Create a new service", value: undefined });
            choice = await (0, prompt_1.promptOnce)({
                message: "Your project already has existing services. Which would you like to set up local files for?",
                type: "list",
                choices,
            });
        }
        if (choice) {
            const serviceName = (0, names_1.parseServiceName)(choice.service.name);
            info.serviceId = serviceName.serviceId;
            info.locationId = serviceName.location;
            info.schemaGql = [];
            info.connectors = [emptyConnector];
            if (choice.schema) {
                const primaryDatasource = choice.schema.datasources.find((d) => d.postgresql);
                if ((_a = primaryDatasource === null || primaryDatasource === void 0 ? void 0 : primaryDatasource.postgresql) === null || _a === void 0 ? void 0 : _a.cloudSql.instance) {
                    const instanceName = (0, names_1.parseCloudSQLInstanceName)(primaryDatasource.postgresql.cloudSql.instance);
                    info.cloudSqlInstanceId = instanceName.instanceId;
                }
                if ((_b = choice.schema.source.files) === null || _b === void 0 ? void 0 : _b.length) {
                    info.schemaGql = choice.schema.source.files;
                }
                info.cloudSqlDatabase = (_d = (_c = primaryDatasource === null || primaryDatasource === void 0 ? void 0 : primaryDatasource.postgresql) === null || _c === void 0 ? void 0 : _c.database) !== null && _d !== void 0 ? _d : "";
                const connectors = await (0, client_1.listConnectors)(choice.service.name, [
                    "connectors.name",
                    "connectors.source.files",
                ]);
                if (connectors.length) {
                    info.connectors = connectors.map((c) => {
                        const id = c.name.split("/").pop();
                        return {
                            id,
                            path: connectors.length === 1 ? "./connector" : `./${id}`,
                            files: c.source.files || [],
                        };
                    });
                }
            }
        }
    }
    return info;
}
async function promptForCloudSQL(setup, info) {
    if (info.cloudSqlInstanceId === "" && setup.projectId) {
        const instances = await cloudsql.listInstances(setup.projectId);
        let choices = instances.map((i) => {
            var _a;
            let display = `${i.name} (${i.region})`;
            if (((_a = i.settings.userLabels) === null || _a === void 0 ? void 0 : _a["firebase-data-connect"]) === "ft") {
                display += " (no cost trial)";
            }
            return { name: display, value: i.name, location: i.region };
        });
        choices = choices.filter((c) => info.locationId === "" || info.locationId === c.location);
        if (choices.length) {
            if (!(await (0, freeTrial_1.checkFreeTrialInstanceUsed)(setup.projectId))) {
                choices.push({ name: "Create a new free trial instance", value: "", location: "" });
            }
            info.cloudSqlInstanceId = await (0, prompt_1.promptOnce)({
                message: `Which CloudSQL instance would you like to use?`,
                type: "list",
                choices,
            });
            if (info.cloudSqlInstanceId !== "") {
                info.locationId = choices.find((c) => c.value === info.cloudSqlInstanceId).location;
            }
        }
    }
    if (info.cloudSqlInstanceId === "") {
        info.isNewInstance = true;
        info.cloudSqlInstanceId = await (0, prompt_1.promptOnce)({
            message: `What ID would you like to use for your new CloudSQL instance?`,
            type: "input",
            default: `${info.serviceId.toLowerCase() || "app"}-fdc`,
        });
    }
    if (info.locationId === "") {
        const choices = await locationChoices(setup);
        info.locationId = await (0, prompt_1.promptOnce)({
            message: "What location would like to use?",
            type: "list",
            choices,
        });
    }
    if (info.cloudSqlDatabase === "" && setup.projectId) {
        try {
            const dbs = await cloudsql.listDatabases(setup.projectId, info.cloudSqlInstanceId);
            const choices = dbs.map((d) => {
                return { name: d.name, value: d.name };
            });
            choices.push({ name: "Create a new database", value: "" });
            if (dbs.length) {
                info.cloudSqlDatabase = await (0, prompt_1.promptOnce)({
                    message: `Which database in ${info.cloudSqlInstanceId} would you like to use?`,
                    type: "list",
                    choices,
                });
            }
        }
        catch (err) {
            logger_1.logger.debug(`[dataconnect] Cannot list databases during init: ${err}`);
        }
    }
    if (info.cloudSqlDatabase === "") {
        info.isNewDatabase = true;
        info.cloudSqlDatabase = await (0, prompt_1.promptOnce)({
            message: `What ID would you like to use for your new database in ${info.cloudSqlInstanceId}?`,
            type: "input",
            default: `fdcdb`,
        });
    }
    return info;
}
async function promptForService(info) {
    if (info.serviceId === "") {
        info.serviceId = await (0, prompt_1.promptOnce)({
            message: "What ID would you like to use for this service?",
            type: "input",
            default: (0, path_1.basename)(process.cwd()),
        });
    }
    return info;
}
async function locationChoices(setup) {
    if (setup.projectId) {
        const locations = await (0, client_1.listLocations)(setup.projectId);
        return locations.map((l) => {
            return { name: l, value: l };
        });
    }
    else {
        return [
            { name: "us-central1", value: "us-central1" },
            { name: "europe-north1", value: "europe-north1" },
            { name: "europe-central2", value: "europe-central2" },
            { name: "europe-west1", value: "europe-west1" },
            { name: "southamerica-west1", value: "southamerica-west1" },
            { name: "us-east4", value: "us-east4" },
            { name: "us-west1", value: "us-west1" },
            { name: "asia-southeast1", value: "asia-southeast1" },
        ];
    }
}
function toDNSCompatibleId(id) {
    let defaultServiceId = (0, path_1.basename)(id)
        .toLowerCase()
        .replaceAll(/[^a-z0-9-]/g, "")
        .slice(0, 63);
    while (defaultServiceId.endsWith("-") && defaultServiceId.length) {
        defaultServiceId = defaultServiceId.slice(0, defaultServiceId.length - 1);
    }
    while (defaultServiceId.startsWith("-") && defaultServiceId.length) {
        defaultServiceId = defaultServiceId.slice(1, defaultServiceId.length);
    }
    return defaultServiceId || "app";
}
exports.toDNSCompatibleId = toDNSCompatibleId;
