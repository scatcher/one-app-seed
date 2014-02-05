'use strict';

angular.module('OneApp')
  .controller('AdminListMapCtrl', ['$scope', '$q', '$location', '$filter', 'dataService',
        function ($scope, $q, $location, $filter, dataService) {
            $scope.lists = dataService.getListCollection();
            $scope.storedLists = {};
            $scope.list = '';
            $scope.listFields = [];
            $scope.includedFields = [];
            $scope.listViews = [];

            $scope.refresh = function() {
                if (!$scope.$$phase) {
                    $scope.$apply();
                }
            };

            function camelize(str) {
                return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) {
                    return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
                }).replace(/\s+/g, '');
            }

            $scope.$watch('list', function(newVal, oldVal) {
                if( _.isUndefined(newVal) || newVal === '') return;
                if(!_.isObject($scope.storedLists[newVal.Title])) {
                    var definition = _.pick(newVal, ['Title', 'ID', 'DefaultViewUrl', 'Description','EnableAttachments', 'EnableModeration', 'EnableVersioning']);
                    _.each(definition, function(value, name) {
                       switch(value){
                           case "True":
                               definition[name] = true;
                               break;
                           case "False":
                               definition[name] = false;
                               break;
                       }
                    });
                    var propertyNameMap = [];
                    definition.fields = [];
                    definition.queries = {};
                    console.log(definition);
                    $scope.storedLists[newVal.Title] = definition;
                }
                $scope.listFields = dataService.getList({listName: newVal.Title});
                $scope.listViews = dataService.getViewCollection({listName: newVal.Title});

                console.log($scope.listFields);
            });

            $scope.addField = function(field) {
                if($scope.list === '')return;
                field.included = true;
                //Set the mapped name property if not provided
                if(_.isUndefined(field.mappedName) || field.mappedName === '') field.mappedName = field.Name;
                //Only include relevant properties
                var definition = _.pick(field, ['Name', 'Type', 'DisplayName', 'Description','Required', 'mappedName']);
                //Add field to the saved definition
                $scope.storedLists[$scope.list.Title].fields.push(definition);
                $scope.refresh();
            };

            $scope.removeField = function(field) {
                if($scope.list === '')return;
                var fields = $scope.storedLists[$scope.list.Title].fields;
                var index = _.indexOf(fields, field);
                fields.splice(index, 1);
                field.included = false;
                $scope.refresh();
            };

            $scope.getViewDetails = function(viewSummary){
                if($scope.list === '') return;
                viewSummary.details = dataService.getView({listName: $scope.list.Title, viewName: viewSummary.name});
                $scope.refresh();
            };

            return $q.all([$scope.lists]);
        }
    ]);