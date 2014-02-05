'use strict';

angular.module('OneApp', [
        //Vendor Services
        'ngRoute',
        'ngResource',
        'ngSanitize',
        'ngAnimate',
        'ngTable',
        'ui.bootstrap',
        'ui.calendar',
        'ui.date',
        'ui.select2',
        'ui.sortable',
        'ui.highlight',
        'angularSpinner'
    ])
    .config(function ($routeProvider) {
        $routeProvider
            // Group Manager
            .when('/group_manager', {
                templateUrl: 'bower_components/one-app-core/modules/group_manager/views/group_manager_view.html',
                controller: 'groupManagerCtrl'
            })

            .when('/offline', {
                templateUrl: 'bower_components/one-app-core/modules/dev/views/generate_offline_view.html',
                controller: 'generateOfflineCtrl'
            })

            /** Route to use if no matching route found **/
            .otherwise({
                redirectTo: '/group_manager'
            });
    })
    .run(function() {
        console.log("Injector done loading all modules.");
    });

