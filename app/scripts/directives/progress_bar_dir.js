'use strict';

angular.module('OneApp')
    .directive('oaProgressBar', function () {
        return {
            restrict: "A",
            replace: true,
            templateUrl: 'scripts/directives/progress_bar_part.html',
            scope: {
                duration: '=',      //Milliseconds to animate
                max: '=',           //Max value
                min: '=',           //Min value (typically 0)
                val: '='            //Current value
            },
            link: function(scope, element, attrs) {

                //Determines bar color based on val
                scope.getBarClass = function() {
                    if(!scope.val) {
                        return 'danger';
                    } else if(scope.val < 36) {
                        return 'warning';
                    } else if(scope.val < 100) {
                        return 'info';
                    } else {
                        return 'success';
                    }
                };

                //Load defaults if not provided
                scope.state = {
                    duration: scope.duration || 1000,
                    max: scope.max || 100,
                    min: scope.min || 0
                };

                scope.$watch('val', function() {
                    //Animate the bar
                    element.find('.progress-bar').animate({ width: scope.val + '%' }, scope.state.duration);
                });
            }
        };
    });