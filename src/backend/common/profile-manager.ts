import { JsonDB } from "node-json-db";
import sanitizeFileName from "sanitize-filename";
import path from "path";
import fs from "fs";

import logger from "../logwrapper";
import { SettingsManager } from "./settings-manager";
import dataAccess from "./data-access";
import frontendCommunicator from "./frontend-communicator";
import { restartApp } from "../app-management/electron/app-helpers";

class ProfileManager {
    loggedInUser: string;
    profileToRename: string;

    constructor() {
        frontendCommunicator.on("profiles:get-logged-in-profile", () => {
            return this.getLoggedInProfile();
        });

        frontendCommunicator.on("createProfile", (profileName: string) => {
            this.createNewProfile(profileName);
        });

        frontendCommunicator.on("deleteProfile", () => {
            this.deleteProfile();
        });

        frontendCommunicator.on("switchProfile", (profileId: string) => {
            this.logInProfile(profileId);
        });

        frontendCommunicator.on("renameProfile", (newProfileId: string) => {
            this.renameProfile(newProfileId);
        });
    }

    private getPathInProfileRelativeToUserData(filepath: string) {
        return path.join("profiles", this.getLoggedInProfile(), filepath);
    }

    /**
     * Actives a different user profile then restarts the app.
     */
    logInProfile(profileId: string) {
        logger.info(`Logging in to profile #${profileId}. Restarting now.`);

        SettingsManager.saveSetting("LoggedInProfile", profileId);

        restartApp();
    }

    profileDataPathExistsSync(filePath: string) {
        const joinedPath = this.getPathInProfileRelativeToUserData(filePath);
        return dataAccess.userDataPathExistsSync(joinedPath);
    }

    deletePathInProfile(filePath: string) {
        const joinedPath = this.getPathInProfileRelativeToUserData(filePath);
        return dataAccess.deletePathInUserData(joinedPath);
    }

    getJsonDbInProfile(filepath: string, humanReadable = true) {
        const jsonDbPath = this.getPathInProfile(filepath);

        try {
            const db = new JsonDB(jsonDbPath, true, humanReadable);
            db.load();
            return db;
        } catch (error) {
            logger.error(`Error loading JsonDB at ${jsonDbPath}. Attempting to recreate.`);

            const fullPath = jsonDbPath.toLowerCase().endsWith(".json")
                ? jsonDbPath
                : `${jsonDbPath}.json`;

            fs.rmSync(fullPath, { force: true });

            return new JsonDB(jsonDbPath, true, humanReadable);
        }
    }

    getPathInProfile(filepath: string) {
        return path.join(dataAccess.getUserDataPath(),
            "profiles",
            this.getLoggedInProfile(),
            filepath);
    }

    /**
     * Create a new user profile
     * @param profileId ID of the profile to create. Defaults to "Main" if unspecified.
     */
    createNewProfile(profileId: string = undefined) {
        let activeProfiles: string[] = [];

        if (profileId == null || profileId === "") {
            profileId = "Main";
        } else {
            profileId = sanitizeFileName(profileId);
        }

        // Get our active profiles
        try {
            // This means we have "Active" profiles that are being used.
            activeProfiles = SettingsManager.getSetting("ActiveProfiles");
        } catch (err) {
        // This means either all profiles have been deleted, or this is our first launch.
            logger.info("No active profiles found while creating a new profile.");
        }

        let counter = 1;
        while (activeProfiles.includes(profileId)) {
            profileId = `${profileId}${counter}`;
            counter++;
        }

        // Get next profile id and push to active profiles.
        activeProfiles.push(profileId);

        // Push our new profile to settings.
        SettingsManager.saveSetting("ActiveProfiles", activeProfiles);
        SettingsManager.saveSetting("LoggedInProfile", profileId);

        logger.info(`New profile created: ${profileId}. Restarting.`);

        // Log the new profile in and restart app.
        this.logInProfile(profileId);
    }

    /**
     * Gets the current logged in user information.
     */
    getLoggedInProfile() {
        // We have a cached logged in user, return it.
        if (this.loggedInUser != null) {
            return this.loggedInUser;
        }

        // Otherwise, let's get it from the global settings file.
        try {
            // We have a value in global settings! Set it to our cache, then return.
            this.loggedInUser = SettingsManager.getSetting("LoggedInProfile");

            if (this.loggedInUser != null) {
                logger.info("Setting logged in user cache.");
                return this.loggedInUser;
            }
        } catch (err) {
            // We don't have a value in our global settings. So, lets try some other things.
            try {
                const globalSettingsDb = dataAccess.getJsonDbInUserData("./global-settings"),
                    activeProfiles = globalSettingsDb.getData("./activeProfiles");

                logger.info("No logged in profile in global settings file. Attempting to set one and restart the app.");
                this.logInProfile(activeProfiles[0]);
            } catch (err) {
            // We don't have any profiles at all. Let's make one.
                this.createNewProfile();
            }
        }
    }

    renameProfile(newProfileId: string) {
        const profileId = this.getLoggedInProfile();
        logger.warn(`User wants to rename profile: ${profileId}. Restarting the app.`);

        let sanitizedNewProfileId = sanitizeFileName(newProfileId);
        if (sanitizedNewProfileId == null || sanitizedNewProfileId === "") {
            logger.error(`Attempted to rename profile to an invalid name: ${newProfileId}`);
            return;
        }

        // Get our active profiles
        let activeProfiles = [];
        try {
        // This means we have "Active" profiles that are being used.
            activeProfiles = SettingsManager.getSetting("ActiveProfiles");
        } catch (err) {
            logger.debug("No active profiles found");
        }

        let counter = 1;
        while (activeProfiles.includes(sanitizedNewProfileId)) {
            sanitizedNewProfileId = `${sanitizedNewProfileId}${counter}`;
            counter++;
        }

        this.profileToRename = sanitizedNewProfileId;

        // Restart the app.
        restartApp();
    }

    // This will mark a profile for deletion on next restart.
    // We can't delete a profile while the app is running (and using the files), so we'll delete it while launching next time.
    deleteProfile() {
        const profileId = this.getLoggedInProfile();
        logger.warn(`User wants to delete profile: ${profileId}. Restarting the app.`);

        // Lets set this profile to be deleted on restart. (When no files are in use).
        SettingsManager.saveSetting("DeleteProfile", profileId);

        // Restart the app.
        restartApp();
    }

    getNewProfileName = () => this.profileToRename;

    hasProfileRename = () => this.profileToRename != null;

    handleProfileRename() {
        if (!this.hasProfileRename()) {
            return;
        }

        try {
            const currentProfileId = this.getLoggedInProfile(),
                newProfileId = this.getNewProfileName(),
                activeProfiles = SettingsManager.getSetting("ActiveProfiles");

            // Stop here if we have no deleted profile info.
            if (currentProfileId != null && newProfileId != null && newProfileId !== "") {
            // Delete the profile.
                logger.warn(`Profile ${currentProfileId} is marked for renaming. Renaming it now.`);

                const currentProfilePath = dataAccess.getPathInUserData(`/profiles/${currentProfileId}`);
                const renamedProfilePath = dataAccess.getPathInUserData(`/profiles/${newProfileId}`);
                logger.warn(currentProfilePath);

                try {
                    fs.renameSync(currentProfilePath, renamedProfilePath);
                } catch (err) {
                    logger.error("Failed to rename profile!", err);
                    return;
                }

                // Remove old id from active profiles and add new
                const profilePosition = activeProfiles.indexOf(currentProfileId);
                activeProfiles[profilePosition] = newProfileId;
                SettingsManager.saveSetting("ActiveProfiles", activeProfiles);

                // Update loggedInProfile
                SettingsManager.saveSetting("LoggedInProfile", newProfileId);

                // Let our logger know we successfully deleted a profile.
                logger.warn(`Successfully renamed profile "${currentProfileId}" to "${newProfileId}"`);
            }
        } catch (err) {
            logger.error("error while renaming profile!", err);
            return;
        }
    }

    handleProfileDeletion() {
        let deletedProfile, activeProfiles;
        try {
            deletedProfile = SettingsManager.getSetting("DeleteProfile");
            activeProfiles = SettingsManager.getSetting("ActiveProfiles");
        } catch (error) {
            if (error.name === 'DatabaseError') {
                logger.error("Error loading deleted and active profiles", error);
            }
        }

        // Stop here if we have no deleted profile info.
        if (deletedProfile == null) {
            return;
        }

        try {

            // Delete the profile.
            logger.warn(`Profile ${deletedProfile} is marked for deletion. Removing it now.`);

            const profilePath = dataAccess.getPathInUserData(`/profiles/${deletedProfile}`);

            logger.warn(profilePath);
            dataAccess.deleteFolderRecursive(profilePath);

            // Remove it from active profiles.
            const profilePosition = activeProfiles.indexOf(deletedProfile);
            if (profilePosition > -1) {
                activeProfiles.splice(profilePosition, 1);
                SettingsManager.saveSetting("ActiveProfiles", activeProfiles);
            }

            // Remove loggedInProfile setting and let restart process handle it.
            if (activeProfiles.length > 0 && activeProfiles != null) {
                // Switch to whatever the first profile is in our new active profiles list.
                SettingsManager.saveSetting("LoggedInProfile", activeProfiles[0]);
            } else {
                // We have no more active profiles, delete the loggedInProfile setting.
                SettingsManager.deleteSetting("LoggedInProfile");
            }

            // Reset the deleteProfile setting.
            SettingsManager.deleteSetting("DeleteProfile");

            // Let our logger know we successfully deleted a profile.
            logger.warn(`Successfully deleted profile: ${deletedProfile}`);

        } catch (err) {
            logger.error("error while deleting profile: ", err);
            return;
        }
    }
}

const profileManager = new ProfileManager();

export { profileManager as ProfileManager };