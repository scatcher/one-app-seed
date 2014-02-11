'use strict';

angular.module('OneApp')
    .service('config', ['$q', function config($q) {

        // AngularJS will instantiate a singleton by calling "new" on this function
        toastr.options.positionClass = 'toast-bottom-right';
        toastr.options.timeOut = 3000;

        //Determines if offline (development) data should be used instead of web service calls
        var offline = window.location.href.indexOf('.mil') === -1 && window.location.href.indexOf('.com') === -1;

        //Prefix that when added to the account name evaluates to the full user login name
        //Only needed if your instance adds a prefix
//        var userLoginNamePrefix = 'i:0#.w|';

        var defaultUrl = $().SPServices.SPGetCurrentSite();

        return {
            debugEnabled: true,
            defaultUrl: defaultUrl,
            offline: offline
        };
    }]);
