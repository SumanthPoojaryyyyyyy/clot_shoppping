"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const pg = require("pg");
const clc = require("colorette");
const cloud_sql_connector_1 = require("@google-cloud/cloud-sql-connector");
const command_1 = require("../command");
const projectUtils_1 = require("../projectUtils");
const ensureApis_1 = require("../dataconnect/ensureApis");
const requirePermissions_1 = require("../requirePermissions");
const fileUtils_1 = require("../dataconnect/fileUtils");
const schemaMigration_1 = require("../dataconnect/schemaMigration");
const requireAuth_1 = require("../requireAuth");
const connect_1 = require("../gcp/cloudsql/connect");
const cloudSqlAdminClient = require("../gcp/cloudsql/cloudsqladmin");
const prompt_1 = require("../prompt");
const logger_1 = require("../logger");
const error_1 = require("../error");
const fbToolsAuthClient_1 = require("../gcp/cloudsql/fbToolsAuthClient");
const interactive_1 = require("../gcp/cloudsql/interactive");
const sqlKeywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "INSERT",
    "UPDATE",
    "DELETE",
    "JOIN",
    "GROUP",
    "ORDER",
    "LIMIT",
    "GRANT",
    "CREATE",
    "DROP",
];
async function promptForQuery() {
    let query = "";
    let line = "";
    do {
        const question = {
            type: "input",
            name: "line",
            message: query ? "> " : "Enter your SQL query (or '.exit'):",
            transformer: (input) => {
                return input
                    .split(" ")
                    .map((word) => (sqlKeywords.includes(word.toUpperCase()) ? clc.cyan(word) : word))
                    .join(" ");
            },
        };
        ({ line } = await (0, prompt_1.prompt)({ nonInteractive: false }, [question]));
        line = line.trimEnd();
        if (line.toLowerCase() === ".exit") {
            return ".exit";
        }
        query += (query ? "\n" : "") + line;
    } while (line !== "" && !query.endsWith(";"));
    return query;
}
async function mainShellLoop(conn) {
    while (true) {
        const query = await promptForQuery();
        if (query.toLowerCase() === ".exit") {
            break;
        }
        if (query === "") {
            continue;
        }
        if (await (0, interactive_1.confirmDangerousQuery)(query)) {
            await (0, interactive_1.interactiveExecuteQuery)(query, conn);
        }
        else {
            logger_1.logger.info(clc.yellow("Query cancelled."));
        }
    }
}
exports.command = new command_1.Command("dataconnect:sql:shell [serviceId]")
    .description("start a shell connected directly to your Data Connect service's linked CloudSQL instance")
    .before(requirePermissions_1.requirePermissions, ["firebasedataconnect.services.list", "cloudsql.instances.connect"])
    .before(requireAuth_1.requireAuth)
    .action(async (serviceId, options) => {
    const projectId = (0, projectUtils_1.needProjectId)(options);
    await (0, ensureApis_1.ensureApis)(projectId);
    const serviceInfo = await (0, fileUtils_1.pickService)(projectId, options.config, serviceId);
    const { instanceId, databaseId } = (0, schemaMigration_1.getIdentifiers)(serviceInfo.schema);
    const { user: username } = await (0, connect_1.getIAMUser)(options);
    const instance = await cloudSqlAdminClient.getInstance(projectId, instanceId);
    const connectionName = instance.connectionName;
    if (!connectionName) {
        throw new error_1.FirebaseError(`Could not get instance connection string for ${options.instanceId}:${options.databaseId}`);
    }
    const connector = new cloud_sql_connector_1.Connector({
        auth: new fbToolsAuthClient_1.FBToolsAuthClient(),
    });
    const clientOpts = await connector.getOptions({
        instanceConnectionName: connectionName,
        ipType: cloud_sql_connector_1.IpAddressTypes.PUBLIC,
        authType: cloud_sql_connector_1.AuthTypes.IAM,
    });
    const pool = new pg.Pool(Object.assign(Object.assign({}, clientOpts), { user: username, database: databaseId }));
    const conn = await pool.connect();
    logger_1.logger.info(`Logged in as ${username}`);
    logger_1.logger.info(clc.cyan("Welcome to Data Connect Cloud SQL Shell"));
    logger_1.logger.info(clc.gray("Type your your SQL query or '.exit' to quit, queries should end with ';' or add empty line to execute."));
    await mainShellLoop(conn);
    logger_1.logger.info(clc.yellow("Exiting shell..."));
    conn.release();
    await pool.end();
    connector.close();
    return { projectId, serviceId };
});
