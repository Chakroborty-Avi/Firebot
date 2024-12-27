"use strict";
const logger = require("../logwrapper");
const dataAccess = require("../common/data-access");
const profileManager = require("../common/profile-manager");
const fs = require("fs");


exports.handleProfileRename = handleProfileRename;
exports.handleProfileDeletion = handleProfileDeletion;