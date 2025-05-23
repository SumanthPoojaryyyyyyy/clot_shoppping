"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const clc = require("colorette");
const command_1 = require("../command");
const fsi = require("../firestore/api");
const types = require("../firestore/api-types");
const logger_1 = require("../logger");
const requirePermissions_1 = require("../requirePermissions");
const types_1 = require("../emulator/types");
const commandUtils_1 = require("../emulator/commandUtils");
const pretty_print_1 = require("../firestore/pretty-print");
const error_1 = require("../error");
exports.command = new command_1.Command("firestore:databases:create <database>")
    .description("create a database in your Firebase project")
    .option("--location <locationId>", "region to create database, for example 'nam5'. Run 'firebase firestore:locations' to get a list of eligible locations (required)")
    .option("--delete-protection <deleteProtectionState>", "whether or not to prevent deletion of database, for example 'ENABLED' or 'DISABLED'. Default is 'DISABLED'")
    .option("--point-in-time-recovery <enablement>", "whether to enable the PITR feature on this database, for example 'ENABLED' or 'DISABLED'. Default is 'DISABLED'")
    .option("-k, --kms-key-name <kmsKeyName>", "the resource ID of a Cloud KMS key. If set, the database created will be a " +
    "Customer-managed Encryption Key (CMEK) database encrypted with this key. " +
    "This feature is allowlist only in initial launch")
    .before(requirePermissions_1.requirePermissions, ["datastore.databases.create"])
    .before(commandUtils_1.warnEmulatorNotSupported, types_1.Emulators.FIRESTORE)
    .action(async (database, options) => {
    const api = new fsi.FirestoreApi();
    const printer = new pretty_print_1.PrettyPrint();
    const helpCommandText = "See firebase firestore:databases:create --help for more info.";
    if (!options.location) {
        throw new error_1.FirebaseError(`Missing required flag --location. ${helpCommandText}`);
    }
    const type = types.DatabaseType.FIRESTORE_NATIVE;
    if (options.deleteProtection &&
        options.deleteProtection !== types.DatabaseDeleteProtectionStateOption.ENABLED &&
        options.deleteProtection !== types.DatabaseDeleteProtectionStateOption.DISABLED) {
        throw new error_1.FirebaseError(`Invalid value for flag --delete-protection. ${helpCommandText}`);
    }
    const deleteProtectionState = options.deleteProtection === types.DatabaseDeleteProtectionStateOption.ENABLED
        ? types.DatabaseDeleteProtectionState.ENABLED
        : types.DatabaseDeleteProtectionState.DISABLED;
    if (options.pointInTimeRecovery &&
        options.pointInTimeRecovery !== types.PointInTimeRecoveryEnablementOption.ENABLED &&
        options.pointInTimeRecovery !== types.PointInTimeRecoveryEnablementOption.DISABLED) {
        throw new error_1.FirebaseError(`Invalid value for flag --point-in-time-recovery. ${helpCommandText}`);
    }
    const pointInTimeRecoveryEnablement = options.pointInTimeRecovery === types.PointInTimeRecoveryEnablementOption.ENABLED
        ? types.PointInTimeRecoveryEnablement.ENABLED
        : types.PointInTimeRecoveryEnablement.DISABLED;
    let cmekConfig;
    if (options.kmsKeyName) {
        cmekConfig = {
            kmsKeyName: options.kmsKeyName,
        };
    }
    const createDatabaseReq = {
        project: options.project,
        databaseId: database,
        locationId: options.location,
        type,
        deleteProtectionState,
        pointInTimeRecoveryEnablement,
        cmekConfig,
    };
    const databaseResp = await api.createDatabase(createDatabaseReq);
    if (options.json) {
        logger_1.logger.info(JSON.stringify(databaseResp, undefined, 2));
    }
    else {
        logger_1.logger.info(clc.bold(`Successfully created ${printer.prettyDatabaseString(databaseResp)}`));
        logger_1.logger.info("Please be sure to configure Firebase rules in your Firebase config file for\n" +
            "the new database. By default, created databases will have closed rules that\n" +
            "block any incoming third-party traffic.");
        logger_1.logger.info(`Your database may be viewed at ${printer.firebaseConsoleDatabaseUrl(options.project, database)}`);
    }
    return databaseResp;
});
