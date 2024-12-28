"use strict";

(function() {
    angular
        .module("firebotApp")
        .factory("profileManagerService", function(backendCommunicator) {
            const getLoggedInProfile = () => {
                return backendCommunicator.fireEventSync("profiles:get-logged-in-profile", () => {
                    return this.getLoggedInProfile();
                });
            };

            return {
                getLoggedInProfile
            };
        });
}());