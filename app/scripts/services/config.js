'use strict';

angular.module('OneApp')
    .service('config', ['$q', function config($q) {
        // AngularJS will instantiate a singleton by calling "new" on this function
        var config = this;
        toastr.options.positionClass = 'toast-bottom-right';
        toastr.options.timeOut = 3000;
        //Determines if offline data should be used instead of web service calls
        var offline = window.location.href.indexOf('.mil') === -1 && window.location.href.indexOf('.com') === -1;

        var defaultUrl = $().SPServices.SPGetCurrentSite();

        return {
            appTitle: 'ESED Dashboard',
            debugEnabled: true,
            defaultUrl: defaultUrl,
            offline: offline
        };
    }]);
