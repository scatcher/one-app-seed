'use strict';

angular.module('OneApp')
    .controller('NavbarCtrl', function ($scope, $route, $location, queue, usSpinnerService) {

        $scope.state = {
            queueCount: 0,
            activeNav: false
        };

        //Trigger loading animation on change in route
        $scope.$on('$routeChangeStart', function (scope, next, current) {
            if (next === current) return;
            queue.increase();
        });

        //Register event listener on the queue service
        queue.registerObserverCallback(function (count) {
            $scope.state.queueCount = count;
            if(count > 0) {
                usSpinnerService.spin('nav-spinner');
            } else {
                usSpinnerService.stop('nav-spinner');
            }
        });
    });