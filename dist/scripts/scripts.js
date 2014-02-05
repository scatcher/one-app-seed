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


'use strict';

angular.module('OneApp')
    .service('queue', function queue() {
        // AngularJS will instantiate a singleton by calling "new" on this function
        //Create a queue
        var counter = 0;
        var increase = function ()
        {
            counter++;
            console.log("Async Queue: " + counter);
            notifyObservers();
            return counter;
        };
        var decrease = function ()
        {
            if (counter > 0)
            {
                counter--;
                console.log("Async Queue: " + counter);
                notifyObservers();
                return counter;
            }
        };

        var reset = function ()
        {
            counter = 0;
            console.log("Async Queue reset to: " + counter);
            notifyObservers();
            return counter;
        };

        var observerCallbacks = [];

        //register an observer
        var registerObserverCallback = function(callback){
            observerCallbacks.push(callback);
        };

        //call this when queue changes
        var notifyObservers = function(){
            angular.forEach(observerCallbacks, function(callback){
                callback(counter);
            });
        };

        return {
            count: counter,
            decrease: decrease,
            increase: increase,
            registerObserverCallback: registerObserverCallback,
            reset: reset
        };
    });
'use strict';

angular.module('OneApp')
    .service('dataService', function ($q, $timeout, config, queue, utility) {
        var dataService = {};

        /**
         * Post processing of data after returning list items from server
         *              -required-
         * @param model | reference to allow upating of model
         * @param response | Resolved promise from web service call
         *              -optional-
         * @param options.factory | Constructor Function
         * @param options.filter | Optional : XML filter
         * @param options.mapping | Field definitions
         * @param options.mode | Options for what to do with local list data array in store [replace, update, return]
         * @param options.target | Optionally pass in array to update
         */
        var processListItems = function (model, response, options) {
            queue.decrease();

            var defaults = {
                factory: model.factory,
                filter: 'z:row',
                mapping: model.list.mapping,
                mode: 'update',
                target: model.data
            };

            var settings = _.extend({}, defaults, options);

            //Map returned XML to

            var xml = config.offline ?
                $(response).SPFilterNode(settings.filter) :
                $(response.responseXML).SPFilterNode(settings.filter);
            var json = utility.xmlToJson(xml, { mapping: settings.mapping });
            var items = [];

            //Use factory to create new object for each returned item
            _.each(json, function (item) {
                items.push(settings.factory(item));
            });

            if (typeof settings.mode === 'replace') {
                //Replace store data
                settings.target = items;
                console.log(model.list.title + ' Replaced with ' + settings.target.length + ' new records.');
            } else if (settings.mode === 'update') {
                var updateCount = 0,
                    createCount = 0;

                //Map to only run through target list once and speed up subsequent lookups
                var idMap = _.pluck(settings.target, 'id');

                //Default: update any existing items in store
                _.each(items, function (item) {
                    if (idMap.indexOf(item.id) === -1) {
                        //No match found, add to target and update map
                        settings.target.push(item);
                        idMap.push(item.id);
                        createCount++;
                    } else {
                        //Replace local item with updated value
                        angular.copy(item, settings.target[idMap.indexOf(item.id)]);
                        updateCount++;
                    }
                });
                console.log(model.list.title + ' Changes (Create: ' + createCount + ' | Update: ' + updateCount + ')');
            }
            return items;
        };

        /**
         * Returns the version history for a field in a list item
         * @param {object} payload
         * @param {object} fieldDefinition: field definition object from the model
         * @returns {promise} Array of list item changes for the specified field
         */
        var getFieldVersionHistory = function (payload, fieldDefinition) {
            var deferred = $q.defer();
            if (config.offline) {
                //Simulate async response if offline
                $timeout(function () {
                    //Resolve and return empty array
                    deferred.resolve([]);
                }, 0);
            } else {
                //SPServices returns a promise
                var webServiceCall = $().SPServices(payload);

                webServiceCall.then(function () {
                    //Success
                    var versions = [];
                    var versionCount = $(webServiceCall.responseText).find("Version").length;
                    $(webServiceCall.responseText).find("Version").each(function (index) {
                        var self = this;

                        var version = {
                            editor: utility.attrToJson($(self).attr("Editor"), 'User'),
                            modified: moment($(self).attr("Modified")).toDate(),
                            //Returns records in desc order so compute the version number from index
                            version: versionCount - index
                        };

                        version[fieldDefinition.mappedName] =
                            utility.attrToJson($(self).attr(fieldDefinition.internalName), fieldDefinition.objectType);

                        //Push to beginning of array
                        versions.unshift(version);
                    });

                    //Resolve and pass back the version history
                    deferred.resolve(versions);
                }, function (outcome) {
                    //Failure
                    toastr.error("Failed to fetch version history.");
                    deferred.reject(outcome);
                });
            }

            return deferred.promise;
        };

        /**
         * @ngdoc function
         * @name dataService.getCollection
         * @description
         * Used to handle any of the Get[filterNode]Collection calls to SharePoint
         *
         * @param {object} options | object used to extend payload and needs to include all SPServices required attributes
         * @param {string} options.operation
         *  - GetUserCollectionFromSite
         *  - GetGroupCollectionFromSite
         *  - GetGroupCollectionFromUser
         *      @requires options.userLoginName
         *  - GetUserCollectionFromGroup
         *      @requires options.groupName
         *  - GetListCollection
         *  - GetViewCollection
         *      @requires options.listName
         *  - GetAttachmentCollection
         *      @requires options.listName
         *      @requires options.ID
         *
         *  @param {string} options.filterNode (Optional: Value to iterate over in returned XML
         *         if not provided it's extracted from the name of the operation
         *         ex: Get[User]CollectionFromSite, "User" is used as the filterNode
         *
         * @returns {promise} when resolved will contain an array of the requested collection
         *
         * @example
         * Typical usage
         * <pre>
         *  dataService.getCollection({
         *       operation: "GetGroupCollectionFromUser",
         *       userLoginName: $scope.state.selectedUser.LoginName
         *  }).then(function (response) {
         *       postProcessFunction(response);
         *  });
         * </pre>
         */
        var getCollection = function (options) {
            queue.increase();
            options = options || {};

            //Determine the XML node to iterate over if filterNode isn't provided
            var filterNode = options.filterNode || options.operation.split("Get")[1].split("Collection")[0];

            var deferred = $q.defer();

            //Convert the xml returned from the server into an array of js objects
            var processXML = function (serverResponse) {
                var convertedItems = [];
                //Get attachments only returns the links associated with a list item
                if (options.operation === "GetAttachmentCollection") {
                    //Unlike other call, get attachments only returns strings instead of an object with attributes
                    $(serverResponse).SPFilterNode(filterNode).each(function () {
                        convertedItems.push($(this).text());
                    });
                } else {
                    convertedItems = $(serverResponse).SPFilterNode(filterNode).SPXmlToJson({
                        includeAllAttrs: true,
                        removeOws: false
                    });
                }
                return convertedItems;
            };

            if (config.offline) {
                var offlineData = 'dev/' + options.operation + '.xml';

                //Get offline data
                $.ajax(offlineData).then(
                    function (offlineData) {
                        queue.decrease();
                        //Pass back the group array
                        deferred.resolve(processXML(offlineData));
                    }, function (outcome) {
                        toastr.error("You need to have a dev/" + options.operation + ".xml in order to get the group collection in offline mode.");
                        deferred.reject(outcome);
                        queue.decrease();
                    });
            } else {
                var validPayload = true;
                var payload = {
                    webURL: options.webURL || config.defaultUrl
                };

                _.extend(payload, options);


                var verifyParams = function (params) {
                    _.each(params, function (param) {
                        if (!payload[param]) {
                            toastr.error("options" + param + " is required to complete this operation");
                            validPayload = false;
                            deferred.reject([]);
                        }
                    });
                };

                //Verify all required params are included
                switch (options.operation) {
                    case "GetGroupCollectionFromUser":
                        verifyParams(['userLoginName']);
                        break;
                    case "GetUserCollectionFromGroup":
                        verifyParams(['groupName']);
                        break;
                    case "GetViewCollection":
                        verifyParams(['listName']);
                        break;
                    case "GetAttachmentCollection":
                        verifyParams(['listName', 'ID']);
                        break;
                }

                if (validPayload) {
                    var webServiceCall = $().SPServices(payload);

                    webServiceCall.then(function () {
                        //Success
                        queue.decrease();
                        deferred.resolve(processXML(webServiceCall.responseXML));
                    }, function (outcome) {
                        //Failure
                        toastr.error("Failed to fetch list collection.");
                        queue.decrease();
                        deferred.reject(outcome);
                    });
                }
            }

            return deferred.promise;

        };

        /**
         * Generic wrapper for any SPServices web service call
         * Check http://spservices.codeplex.com/documentation for details on expected parameters for each operation
         *
         * @param {object} options - payload params
         * @returns {promise}
         *      If options.filterNode is provided, returns XML parsed by node name
         *      Otherwise returns the server response
         */
        var serviceWrapper = function (options) {
            queue.increase();
            options = options || {};

            var deferred = $q.defer();

            //Convert the xml returned from the server into an array of js objects
            var processXML = function (serverResponse) {
                if(options.filterNode) {
                    return $(serverResponse).SPFilterNode(options.filterNode).SPXmlToJson({
                        includeAllAttrs: true,
                        removeOws: false
                    });
                } else {
                    return serverResponse;
                }
            };

            if (config.offline) {
                //Debugging offline
                var offlineData = 'dev/' + options.operation + '.xml';

                //Get offline data
                $.ajax(offlineData).then(
                    function (offlineData) {
                        queue.decrease();
                        //Pass back the group array
                        deferred.resolve(processXML(offlineData));
                    }, function (outcome) {
                        toastr.error("You need to have a dev/" + options.operation + ".xml in order to get the group collection in offline mode.");
                        deferred.reject(outcome);
                        queue.decrease();
                    });
            } else {
                //Add in webURL to speed up call, set to default if not specified
                var payload = {
                    webURL: options.webURL || config.defaultUrl
                };

                _.extend(payload, options);

                var webServiceCall = $().SPServices(payload);

                webServiceCall.then(function () {
                    //Success
                    queue.decrease();
                    deferred.resolve(processXML(webServiceCall.responseXML));
                }, function (outcome) {
                    //Failure
                    toastr.error("Failed to fetch list collection.");
                    queue.decrease();
                    deferred.reject(outcome);
                });
            }
            return deferred.promise;
        };

        /**
         * Returns all list settings for each list on the site
         * @param options.listName (required)
         * @param options.webURL returns info for specified site (optional)
         * @returns promise for json dataset
         */
        var getList = function (options) {
            options = options || {};
            queue.increase();
            var deferred = $q.defer();

            var webServiceCall = $().SPServices({
                operation: "GetList",
                listName: options.listName,
                webURL: options.webURL || config.defaultUrl
            });

            webServiceCall.then(function () {
                //Success
                queue.decrease();

                //Map returned XML to JSON
                var json = $(webServiceCall.responseXML).SPFilterNode("Field").SPXmlToJson({
                    includeAllAttrs: true,
                    removeOws: false
                });
                //Pass back the lists array
                deferred.resolve(json);
            },function (outcome) {
                //Failure
                deferred.reject(outcome);
                toastr.error("Failed to fetch list details.");
            }).always(function () {
                queue.decrease();
            });

            return deferred.promise;
        };

        var deleteAttachment = function (options) {
            options = options || {};
            queue.increase();
            var deferred = $q.defer();

            var webServiceCall = $().SPServices({
                operation: "DeleteAttachment",
                listItemID: options.listItemId,
                url: options.url,
                listName: options.listName,
                webURL: options.webURL || config.defaultUrl
            });

            webServiceCall.then(function () {
                //Success
                queue.decrease();

                //Map returned XML to JSON
                var json = $(webServiceCall.responseXML).SPFilterNode("Field").SPXmlToJson({
                    includeAllAttrs: true,
                    removeOws: false
                });
                //Pass back the lists array
                deferred.resolve(json);
            },function (outcome) {
                //Failure
                deferred.reject(outcome);
                toastr.error("Failed to fetch list details.");
            }).always(function () {
                queue.decrease();
            });

            return deferred.promise;
        };

        /**
         * Returns details of a SharePoint list view
         * @param options.listName (required)
         * @param options.viewName (optional) ***Formatted as a GUID ex: "{37388A98-534C-4A28-BFFA-22429276897B}"
         * @param options.webURL (optional)
         * @returns {promise for object}
         */
        var getView = function (options) {
            queue.increase();
            var deferred = $q.defer();

            var payload = {
                operation: "GetView",
                listName: options.listName,
                webURL: options.webURL || config.defaultUrl
            };

            //Set view name if provided in options, otherwise it returns default view
            if (_.isDefined(options.viewName)) payload.viewName = options.viewName;

            var webServiceCall = $().SPServices(payload);

            webServiceCall.then(function () {
                //Success
                var output = {
                    query: "<Query>" + $(webServiceCall.responseText).find("Query").html() + "</Query>",
                    viewFields: "<ViewFields>" + $(webServiceCall.responseText).find("ViewFields").html() + "</ViewFields>",
                    rowLimit: $(webServiceCall.responseText).find("RowLimit").html()
                };

                //Pass back the lists array
                deferred.resolve(output);
            },function (outcome) {
                //Failure
                toastr.error("Failed to fetch view details.");
                deferred.reject(outcome);
            }).always(function () {
                queue.decrease();
            });

            return deferred.promise;
        };


        /**
         * Combines the ready promises for a controller into an array and
         * adds a reference to each of the models data sources to the scope
         * @param {object} scope - Reference to the controllers scope
         * @param {array} models - Array of models to register/add to scope
         * @returns Combines the test
         */
        var registerModels = function (scope, models) {
//                scope.promises = scope.promises || [];
            var promises = [];
            //Add simple refresh functionality
            scope.refresh = function () {
                if (!scope.$$phase) {
                    scope.$apply();
                }
            };
            _.each(models, function (model) {
                promises.push(model.ready.promise);
                scope[utility.toCamelCase(model.list.title)] = model.data;
            });
            return $q.all(promises);
        };

        /** Pulls down any list item changes that have occurred since the last time the query was called **/
        var getUpdatesSinceToken = function (model, query, options) {
            var defaults = {};
            var deferred = $q.defer();
            //Replace defaults with any values supplied in options
            var settings = _.extend({}, defaults, options);

            //Check for changes
            dataService.initializeModel(model, query, {deferred: deferred}).then(function (updates) {
                console.log(updates);
                //If onAfterChange callback is provided and data has changed, call it
                if (_.isFunction(settings.onAfterChange)) {
                    settings.onAfterChange();
                }
                deferred.resolve(updates);
                keepDataUpdated(model, query, options);
            });

            return deferred.promise;
        };


        /**
         * Timer job to check for updates to a list using the GetListItemChangesSinceToken service
         * GetListItemChangesSinceToken is similar to GetListItems and accepts all the same params but also includes a changeToken param
         * Initial request doesn't include a changeToken param and returns the entire list definition, a change token, and the query results
         * Each subsequent call uses this token to return just the delta (token only updates when there has been a change)
         * Deleted items are returned as "Id" elements with a changeType of Delete
         * http://blogs.msdn.com/b/sharepointdeveloperdocs/archive/2008/01/21/synchronizing-with-windows-sharepoint-services-part-1.aspx
         * @param {object} model
         * @param {object} query
         * @param {number} options.timeout - milliseconds between server refresh
         * @callback {function} options.onAfterChange - callback called after response from server
         * @returns {promise}
         */
        var keepDataUpdated = function (model, query, options) {
            var defaults = {
                timeout: 30000 //30 seconds
            };

            //Replace defaults with any values supplied in options
            var settings = _.extend({}, defaults, options);

            //Delay before running
            $timeout(function () {
                //Check for changes
                getUpdatesSinceToken(model, query, options);
            }, settings.timeout);
        };

        /**
         * Takes in the model and a query that
         * @param {object} model
         * @param {object} query
         * @param options.deferred //Optionally pass in another deferred object to resolve(default: model.ready)
         * @param options.offlineXML //Alternate location to XML data file
         * @returns {promise} - Returns reference to model
         */
        var initializeModel = function (model, query, options) {
            //Display animation
            queue.increase();
            options = options || {};

            var deferredObj = options.deferred || model.ready;

            if (config.offline) {
                //Optionally set alternate offline XML location but default to value in model
                var offlineData = options.offlineXML || 'dev/' + model.list.title + '.xml';

                //Get offline data
                $.ajax(offlineData).then(function (offlineData) {
                    var changes = processListItems(model, offlineData, options);
                    //Set date time to allow for time based updates
                    query.lastRun = new Date();
                    queue.decrease();
                    deferredObj.resolve(changes);
                });
            } else if (query) {
                var webServiceCall = $().SPServices(query);
                webServiceCall.then(function () {
                    if (query.operation === "GetListItemChangesSinceToken") {
                        //Find element containing the token (should only be 1 but use .each to be safe)
                        $(webServiceCall.responseXML).SPFilterNode('Changes').each(function () {
                            //Retrieve the token string
                            var token = $(this).attr("LastChangeToken");
                            //Store token for future web service calls to return changes
                            query.changeToken = token;
                        });
                        var deleteCount = 0;
                        //Remove any local list items that were deleted from the server
                        $(webServiceCall.responseXML).SPFilterNode('Id').each(function () {
                            //Check for the type of change
                            var changeType = $(this).attr("ChangeType");
                            if (changeType === "Delete") {
                                var itemId = parseInt($(this).text(), 10);
                                //Remove from local data array
                                var item = _.findWhere(model.data, {id: itemId});
                                var index = _.indexOf(model.data, item);
                                if (index) {
                                    deleteCount++;
                                    //Remove the locally cached record
                                    model.data.splice(index, 1);
                                }
                            }
                        });
                        if (deleteCount > 0) {
                            console.log(deleteCount + ' item(s) removed from local cache to mirror changes on source list.');
                        }
                    }
                    //Convert the XML into JS
                    var changes = processListItems(model, webServiceCall);
                    //Set date time to allow for time based updates
                    query.lastRun = new Date();
                    queue.decrease();
                    deferredObj.resolve(changes);
                });
            }

            return deferredObj.promise;
        };

        /**
         *
         * @param pairOptions.list Object (Need either list or list name)
         * @param pairOptions.listName String
         * @param pairOptions.definition Object from fields in store array
         * @param pairOptions.propertyName
         * @param pairOptions.value (Required)
         *
         */

        var createValuePair = function (field, value) {
            var valuePair = [];

            var stringifyArray = function (idProperty) {
                if (value && value.length) {
                    var arrayValue = '';
                    _.each(value, function (lookupObject, iteration) {
                        //Need to format string of id's in following format [ID0];#;#[ID1];#;#[ID1]
                        arrayValue += lookupObject[idProperty];
                        if (iteration < value.length) {
                            arrayValue += ';#;#';
                        }
                    });
                    valuePair = [field.internalName, arrayValue];
                } else {
                    //Array is empty
                    valuePair = [field.internalName, ''];
                }
            };

            var internalName = field.internalName;

            if (_.isUndefined(value) || value === '') {
                //Create empty value pair if blank or undefined
                valuePair = [internalName, ''];
            } else {
                switch (field.objectType) {
                    case "Lookup":
                    case "User":
                        if (_.isUndefined(value.lookupId)) {
                            valuePair = [internalName, ''];
                        } else {
                            valuePair = [internalName, value.lookupId];
                        }
                        break;
                    case "LookupMulti":
                    case "UserMulti":
                        stringifyArray('lookupId');
                        break;
                    case "Boolean":
                        valuePair = [internalName, value ? 1 : 0];
                        break;
                    case "DateTime":
                        if (moment(value).isValid()) {
                            valuePair = [internalName, moment(value).format()];
                        } else {
                            valuePair = [internalName, ''];
                        }
                        break;
                    case "Note":
                    case "HTML":
                        valuePair = [internalName, _.escape(value)];
                        break;
                    case "JSON":
                        valuePair = [internalName, angular.toJson(value)];
                        break;
                    default:
                        valuePair = [internalName, value];
                }
                console.log('{' + field.objectType + '} ' + valuePair);
            }
            return valuePair;
        };

        var addUpdateItemModel = function (model, item, options) {
            var defaults = {
                mode: 'update',  //Options for what to do with local list data array in store [replace, update, return]
                buildValuePairs: true,
                valuePairs: []
            };
            var deferred = $q.defer();
            options = options || {};
            var settings = _.extend(defaults, options);

            //Display loading animation
            queue.increase();

            if (settings.buildValuePairs === true) {
                var editableFields = _.where(model.list.fields, {readOnly: false});
                _.each(editableFields, function (field) {
                    //Check to see if item contains data for this field
                    if (_.has(item, field.mappedName)) {
                        settings.valuePairs.push(
                            createValuePair(field, item[field.mappedName])
                        );
                    }
                });
            }
            var payload = {
                operation: "UpdateListItems",
                webURL: model.list.webURL,
                listName: model.list.guid,
                valuepairs: settings.valuePairs
            };

            if ((_.isObject(item) && _.isNumber(item.id))) {
                //Updating existing list item
                payload.batchCmd = "Update";
                payload.ID = item.id;
            } else {
                //Creating new list item
                payload.batchCmd = "New";
            }

            window.console.log(payload);

            if (config.offline) {
                //Offline mode
                var offlineDefaults = {
                    modified: new Date(),
                    editor: {
                        lookupId: 23,
                        lookupValue: 'Hatcher, Scott B CIV ESED, JXPML'
                    }
                };
                if (_.isUndefined(item.id)) {
                    //Creating new item so find next logical id to assign
                    var maxId = 0;
                    _.each(model.data, function (item) {
                        if (item.id > maxId) {
                            maxId = item.id;
                        }
                    });
                    //Include additional fields for new item
                    offlineDefaults.author = {
                        lookupId: 23,
                        lookupValue: 'Hatcher, Scott B CIV ESED, JXPML'
                    };
                    offlineDefaults.created = new Date();
                    offlineDefaults.id = maxId++;
                    //Use factory to build new object
                    var newItem = model.factory(_.defaults(item, offlineDefaults));
                    model.data.push(newItem);
                    deferred.resolve(newItem);
                } else {
                    //Update existing record
                    _.extend(item, offlineDefaults);
                    deferred.resolve(item);
                }
                queue.decrease();
            } else {
                var webServiceCall = $().SPServices(payload);

                webServiceCall.then(function () {
                    //Success
                    var output = processListItems(model, webServiceCall, settings);
                    deferred.resolve(output[0]);

                },function (outcome) {
                    //In the event of an error, display toast
                    toastr.error("There was an error getting the requested data from " + model.list.name);
                    deferred.reject(outcome);
                }).always(function () {
                    queue.decrease();
                });
            }
            return deferred.promise;
        };

        var deleteItemModel = function (model, item) {
            queue.increase();
            var payload = {
                operation: "UpdateListItems",
                webURL: model.list.webURL,
                listName: model.list.guid,
                batchCmd: "Delete",
                ID: item.id
            };
            var deferred = $q.defer();

            function removeItemFromMemory() {
                var index = _.indexOf(model.data, item);
                if (index) {
                    //Remove the locally cached record
                    model.data.splice(index, 1);
                }
            }

            if (config.offline) {
                //Simulate deletion and remove locally
                removeItemFromMemory();
                queue.decrease();
                deferred.resolve(model.list.data);
            } else {
                var webServiceCall = $().SPServices(payload);

                webServiceCall.then(function (response) {
                    //Success
                    removeItemFromMemory();
                    deferred.resolve(response);
                },function (outcome) {
                    //In the event of an error, display toast
                    toastr.error("There was an error deleting a list item from " + model.list.title);
                    deferred.reject(outcome);
                }).always(function () {
                    queue.decrease();
                });
            }
            return deferred.promise;
        };

        _.extend(dataService, {
            addUpdateItemModel: addUpdateItemModel,
            createValuePair: createValuePair,
            deleteAttachment: deleteAttachment,
            deleteItemModel: deleteItemModel,
            getCollection: getCollection,
            getFieldVersionHistory: getFieldVersionHistory,
            getList: getList,
            getUpdatesSinceToken: getUpdatesSinceToken,
            getView: getView,
            initializeModel: initializeModel,
            keepDataUpdated: keepDataUpdated,
            processListItems: processListItems,
            registerModels: registerModels,
            serviceWrapper: serviceWrapper
        });

        return dataService;

    }
);
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

'use strict';

angular.module('OneApp')
    .service('utility', function utility() {
        // AngularJS will instantiate a singleton by calling "new" on this function

        //Extend underscore
        _.mixin({
            isDefined: function (value) {
                return !_.isUndefined(value);
            }
        });

        // Modified version of SPServices "SPXmlToJson" function
        /**
         * This function converts an XML node set to JSON
         * @param rows ["z:rows"]
         * @param options.mapping [columnName: mappedName: "mappedName", objectType: "objectType"]
         * @param options.includeAllAttrs [If true, return all attributes, regardless whether they are in the mapping]
         * @param options.removeOws [Specifically for GetListItems, if true, the leading ows_ will be stripped off the field name]
         * @returns {Array}
         */
        var xmlToJson = function (rows, options) {

            var opt = $.extend({}, {
                mapping: {},
                includeAllAttrs: false,
                removeOws: true
            }, options);

            var attrNum;
            var jsonObject = [];

            _.each(rows, function (item) {
                var row = {};
                var rowAttrs = item.attributes;

                // Bring back all mapped columns, even those with no value
                _.each(opt.mapping, function (prop) {
                    row[prop.mappedName] = "";
                });

                // Parse through the element's attributes
                for (attrNum = 0; attrNum < rowAttrs.length; attrNum++) {
                    var thisAttrName = rowAttrs[attrNum].name;
                    var thisMapping = opt.mapping[thisAttrName];
                    var thisObjectName = typeof thisMapping !== "undefined" ? thisMapping.mappedName : opt.removeOws ? thisAttrName.split("ows_")[1] : thisAttrName;
                    var thisObjectType = typeof thisMapping !== "undefined" ? thisMapping.objectType : undefined;
                    if (opt.includeAllAttrs || thisMapping !== undefined) {
                        row[thisObjectName] = attrToJson(rowAttrs[attrNum].value, thisObjectType);
                    }
                }
                // Push this item into the JSON Object
                jsonObject.push(row);

            });

            // Return the JSON object
            return jsonObject;

        }; // End $.fn.SPServices.SPXmlToJson


        /**
         * Converts a SharePoint string representation of a field into the correctly formatted JS version
         * @param v
         * @param objectType
         * @returns {*}
         */
        function attrToJson(v, objectType) {

            var colValue;

            switch (objectType) {
                case "DateTime":
                case "datetime":	// For calculated columns, stored as datetime;#value
                    // Dates have dashes instead of slashes: ows_Created="2009-08-25 14:24:48"
                    colValue = dateToJsonObject(v);
                    break;
                case "Lookup":
                    colValue = lookupToJsonObject(v);
                    break;
                case "User":
                    colValue = userToJsonObject(v);
                    break;
                case "LookupMulti":
                    colValue = lookupMultiToJsonObject(v);
                    break;
                case "UserMulti":
                    colValue = userMultiToJsonObject(v);
                    break;
                case "Boolean":
                    colValue = booleanToJsonObject(v);
                    break;
                case "Integer":
                    colValue = intToJsonObject(v);
                    break;
                case "Counter":
                    colValue = intToJsonObject(v);
                    break;
                case "MultiChoice":
                    colValue = choiceMultiToJsonObject(v);
                    break;
                case "Currency":
                case "Number":
                case "float":	// For calculated columns, stored as float;#value
                    colValue = floatToJsonObject(v);
                    break;
                case "Calc":
                    colValue = calcToJsonObject(v);
                    break;
                case "JSON":
                    colValue = parseJSON(v);
                    break;
                default:
                    // All other objectTypes will be simple strings
                    colValue = stringToJsonObject(v);
                    break;
            }
            return colValue;
        }

        function parseJSON(s) {
            return JSON.parse(s);
        }

        function stringToJsonObject(s) {
            return s;
        }

        function intToJsonObject(s) {
            return parseInt(s, 10);
        }

        function floatToJsonObject(s) {
            return parseFloat(s);
        }

        function booleanToJsonObject(s) {
            return (s === "0" || s === "False") ? false : true;
        }

        function dateToJsonObject(s) {
            return new Date(s.replace(/-/g, "/"));
        }

        function userToJsonObject(s) {
            if (s.length === 0) {
                return null;
            }
            //Send to constructor
            return new User(s);
        }

        function userMultiToJsonObject(s) {
            if (s.length === 0) {
                return null;
            } else {
                var thisUserMultiObject = [];
                var thisUserMulti = s.split(";#");
                for (var i = 0; i < thisUserMulti.length; i = i + 2) {
                    var thisUser = userToJsonObject(thisUserMulti[i] + ";#" + thisUserMulti[i + 1]);
                    thisUserMultiObject.push(thisUser);
                }
                return thisUserMultiObject;
            }
        }

        function lookupToJsonObject(s) {
            if (s.length === 0) {
                return null;
            } else {
                //Send to constructor
                return new Lookup(s);
            }
        }

        function lookupMultiToJsonObject(s) {
            if (s.length === 0) {
                return [];
            } else {
                var thisLookupMultiObject = [];
                var thisLookupMulti = s.split(";#");
                for (var i = 0; i < thisLookupMulti.length; i = i + 2) {
                    var thisLookup = lookupToJsonObject(thisLookupMulti[i] + ";#" + thisLookupMulti[i + 1]);
                    thisLookupMultiObject.push(thisLookup);
                }
                return thisLookupMultiObject;
            }
        }

        function choiceMultiToJsonObject(s) {
            if (s.length === 0) {
                return [];
            } else {
                var thisChoiceMultiObject = [];
                var thisChoiceMulti = s.split(";#");
                for (var i = 0; i < thisChoiceMulti.length; i++) {
                    if (thisChoiceMulti[i].length !== 0) {
                        thisChoiceMultiObject.push(thisChoiceMulti[i]);
                    }
                }
                return thisChoiceMultiObject;
            }
        }

        function calcToJsonObject(s) {
            if (s.length === 0) {
                return null;
            } else {
                var thisCalc = s.split(";#");
                // The first value will be the calculated column value type, the second will be the value
                return attrToJson(thisCalc[1], thisCalc[0]);
            }
        }

        function htmlToJsonObject(s) {
            return _.unescape(s);
        }

        // Split values like 1;#value into id and value
        function SplitIndex(s) {
            var spl = s.split(";#");
            this.id = parseInt(spl[0], 10);
            this.value = spl[1];
        }

        function toCamelCase(s) {
            return s.replace(/(?:^\w|[A-Z]|\b\w)/g,function (letter, index) {
                return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
            }).replace(/\s+/g, '');
        }

        function fromCamelCase(s) {
            // insert a space before all caps
            s.replace(/([A-Z])/g, ' $1')
                // uppercase the first character
                .replace(/^./, function (str) {
                    return str.toUpperCase();
                });
        }

        /**Constructors for user and lookup fields*/
        /**Allows for easier distinction when debugging if object type is shown as either Lookup or User**/
        function Lookup(s) {
            var thisLookup = new SplitIndex(s);
            this.lookupId = thisLookup.id;
            this.lookupValue = thisLookup.value;
        }

        function User(s) {
            var self = this;
            var thisUser = new SplitIndex(s);
//                self.lookupId = thisUser.id;
//                self.lookupValue = thisUser.value;
//                return {userId: thisUser.id, lookupValue: thisUser.value};

            var thisUserExpanded = thisUser.value.split(",#");
            if (thisUserExpanded.length === 1) {
                //Standard user columns only return a id,#value pair
                self.lookupId = thisUser.id;
                self.lookupValue = thisUser.value;
            } else {
                //Allow for case where user adds additional properties when setting up field
                self.lookupId = thisUser.id;
                self.lookupValue = thisUserExpanded[0].replace(/(,,)/g, ",");
                self.loginName = thisUserExpanded[1].replace(/(,,)/g, ",");
                self.email = thisUserExpanded[2].replace(/(,,)/g, ",");
                self.sipAddress = thisUserExpanded[3].replace(/(,,)/g, ",");
                self.title = thisUserExpanded[4].replace(/(,,)/g, ",");
            }
        }

        return {
            attrToJson: attrToJson,
            fromCamelCase: fromCamelCase,
            lookupToJsonObject: lookupToJsonObject,
            SplitIndex: SplitIndex,
            toCamelCase: toCamelCase,
            xmlToJson: xmlToJson
        };
    });
'use strict';

angular.module('OneApp')
    .factory('modelFactory', function ($q, $timeout, config, utility, dataService) {
        /**
         * Decorates field with optional defaults
         * @param definition
         * @returns {Field}
         * @constructor
         */
        function Field(obj) {
            var self = this;
            var defaults = {
                readOnly: false,
                objectType: 'Text'
            };
            _.extend(self, defaults, obj);
            self.displayName = self.displayName || utility.fromCamelCase(self.mappedName);
        }

        /**
         * Model Constructor
         * Provides the Following
         * - adds an empty "data" array
         * - adds an empty "queries" object
         * - adds a deferred obj "ready"
         * - builds "model.list" with constructor
         * - adds "getAllListItems" function
         * - adds "addNewItem" function
         * @param {object} model *Required
         * @constructor
         */
        function Model(options) {
            var self = this;
            var defaults = {
                data: [],
                queries: {},
                ready: $q.defer()
            };

            _.extend(self, defaults, options);

            self.dataService = dataService;
            self.list = new List(self.list);
            //Add a query to pull all list items
            self.queries.allListItems = new Query({
                operation: "GetListItems",
                listName: self.list.guid,
                viewFields: self.list.viewFields
            });

            return self;
        }

        /**
         * Inherited from Model constructor
         * Gets all list items in the current list, processes the xml, and adds the data to the model
         * Uses new deferred object instead of resolving self.ready
         * @returns {promise}
         */
        Model.prototype.getAllListItems = function () {
            var deferred = $q.defer();
            dataService.initializeModel(this, this.queries.getAllListItems, {deferred: deferred})
                .then(function (response) {
                    deferred.resolve(response);
                });
            return deferred.promise();
        };

        /**
         * If online and sync is being used, notify all online users that a change has been made
         * @param {promise} Update event
         */
        function registerChange(self) {
            if(!config.offline && self.sync && _.isFunction(self.sync.registerChange)) {
                //Register change after successful update
                self.sync.registerChange();
            }
        }

        /**
         * Inherited from Model constructor
         * @param obj
         * @example {title: "Some Title", date: new Date()}
         * @returns {*}
         */
        Model.prototype.addNewItem = function (obj) {
            var self = this;
            var deferred = $q.defer();
            dataService.addUpdateItemModel(self, obj).then(function(response) {
                deferred.resolve(response);
                //Optionally broadcast change event
                registerChange(self);
            });

            return deferred.promise;
        };

        /**
         * Constructor for creating a list item which inherits CRUD functionality that can be called directly from obj
         * @param {object} obj - List item
         * @param {object} model - Reference to the model
         * @param {object} dataService - Reference to DataService
         * @returns {ListItem}
         * @constructor
         */
        function ListItem(obj, model) {
            var self = this;
            self.dataService = dataService;

            self.getDataService = function () {
                return dataService;
            };

            self.getModel = function () {
                return model;
            };

            _.extend(self, obj);
        }


        /**
         * Updates record directly from the object
         * @param {object} options - optionally pass params to the dataService
         * @returns {promise}
         */
        ListItem.prototype.saveChanges = function (options) {
            var self = this;
            var model = self.getModel();
            var deferred = $q.defer();

            dataService.addUpdateItemModel(model, self, options).then(function(response) {
                deferred.resolve(response);
                //Optionally broadcast change event
                registerChange(model);
            });

            return deferred.promise;
        };

        /**
         * Deletes record directly from the object and removes record from user cache
         * @param {object} options - optionally pass params to the dataService
         * @returns {promise}
         */
        ListItem.prototype.deleteItem = function () {
            var self = this;
            var model = self.getModel();
            var deferred = $q.defer();

            dataService.deleteItemModel(model, self).then(function(response) {
                deferred.resolve(response);
                //Optionally broadcast change event
                registerChange(model);
            });

            return deferred.promise;
        };

        /**
         * Requests all attachments for the object
         * @param {object} options - optionally pass params to the dataService
         * @returns {promise} - containing attachment collection
         */
        ListItem.prototype.getAttachmentCollection = function () {
            return dataService.getCollection({
                operation: 'GetAttachmentCollection',
                listName: this.getModel().list.guid,
                webURL: this.getModel().list.webURL,
                ID: this.id,
                filterNode: 'Attachment'
            });
        };

        /**
         * Delete an attachment using the attachment url
         * @param {object} options - optionally pass params to the dataService
         * @returns {promise} - containing attachment collection
         */
        ListItem.prototype.deleteAttachment = function (url) {
            var self = this;
            return dataService.deleteAttachment({
                listItemId: self.id,
                url: url,
                listName: self.getModel().list.guid
            });
        };

        /**
         * @returns {Object} Contains properties for each permission level evaluated for current user(true | false)
         */
        ListItem.prototype.resolvePermissions = function () {
            return resolvePermissions(this);
        };


        /**
         * Returns the version history for a specific field
         * @fieldNames {array} the js mapped name of the fields (ex: [title])
         * @returns {promise} - containing array of changes
         */
        ListItem.prototype.getFieldVersionHistory = function (fieldNames) {
            var deferred = $q.defer();
            var promiseArray = [];
            var self = this;
            var model = this.getModel();

            //Creates a promise for each field
            var createPromise = function (fieldName) {

                var fieldDefinition = _.findWhere(model.list.fields, {mappedName: fieldName});

                var payload = {
                    operation: "GetVersionCollection",
                    webURL: config.defaultUrl,
                    strlistID: model.list.title,
                    strlistItemID: self.id,
                    strFieldName: fieldDefinition.internalName
                };

                promiseArray.push(dataService.getFieldVersionHistory(payload, fieldDefinition));
            };

            if (!_.isArray(fieldNames)) {
                fieldNames = [fieldNames];
            }

            //Generate promises for each field
            _.each(fieldNames, function (fieldName) {
                createPromise(fieldName);
            });


            //Pause until everything is resolved
            $q.all(promiseArray).then(function (changes) {
                var versionHistory = {};

                //All fields should have the same number of versions
                _.each(changes, function (fieldVersions) {

                    _.each(fieldVersions, function (fieldVersion) {
                        if (!versionHistory[fieldVersion.modified.toJSON()]) {
                            versionHistory[fieldVersion.modified.toJSON()] = {};
                        }
                        //Add field to the version history for this version
                        _.extend(versionHistory[fieldVersion.modified.toJSON()], fieldVersion);
                    });
                });

                var versionArray = [];
                //Add a version prop on each version to identify the numeric sequence
                _.each(versionHistory, function (ver, num) {
                    ver.version = num;
                    versionArray.push(ver);
                });

                console.log(versionArray);
                deferred.resolve(versionArray);
            });

            return deferred.promise;
        };

        /**
         * List Object Constructor
         * @param obj.customFields  *Optional
         * @param obj.guid          *Required
         * @param obj.title         *Required
         * @constructor
         */
        function List(obj) {
            var defaults = {
                viewFields: '',
                customFields: [],
                isReady: false,
                fields: [],
                guid: '',
                mapping: {},
                title: '',
                webURL: config.defaultUrl
            };

            var list = _.extend({}, defaults, obj);

            /**
             * Read only fields that should be included in all lists
             * @type {Array}
             */
            var defaultFields = [
                { internalName: "ID", objectType: "Counter", mappedName: "id", readOnly: true},
                { internalName: "Modified", objectType: "DateTime", mappedName: "modified", readOnly: true},
                { internalName: "Created", objectType: "DateTime", mappedName: "created", readOnly: true},
                { internalName: "Author", objectType: "User", sid: true, mappedName: "author", readOnly: true},
                { internalName: "Editor", objectType: "User", sid: true, mappedName: "editor", readOnly: true},
                { internalName: "PermMask", objectType: "Text", mappedName: "permMask", readOnly: true}
            ];

            /**
             * Constructs the field
             * - adds to viewField
             * - create ows_ mapping
             * @param fieldDefinition
             */
            var buildField = function (fieldDefinition) {
                var field = new Field(fieldDefinition);
                list.fields.push(field);
                list.viewFields += '<FieldRef Name="' + field.internalName + '"/>';
                list.mapping['ows_' + field.internalName] = { mappedName: field.mappedName, objectType: field.objectType };
            };

            /** Open viewFields */
            list.viewFields += '<ViewFields>';

            /** Add the default fields */
            _.each(defaultFields, function (field) {
                buildField(field);
            });

            /** Add each of the fields defined in the model */
            _.each(list.customFields, function (field) {
                buildField(field);
            });

            /** Close viewFields */
            list.viewFields += '</ViewFields>';

            return list;
        }

        /**
         * Decorates query optional attributes
         * @param obj
         * @returns {Query}
         * @constructor
         */
        function Query(obj) {
            var defaults = {
                lastRun: null,              // the date/time last run
                webURL: config.defaultUrl,
                queryOptions: '' +
                    '<QueryOptions>' +
                    '<IncludeMandatoryColumns>FALSE</IncludeMandatoryColumns>' +
                    '<IncludeAttachmentUrls>TRUE</IncludeAttachmentUrls>' +
                    '<IncludeAttachmentVersion>FALSE</IncludeAttachmentVersion>' +
                    '<ExpandUserField>FALSE</ExpandUserField>' +
                    '</QueryOptions>',
                query: '' +
                    '<Query>' +
                    '<OrderBy>' +
                    '<FieldRef Name="ID" Ascending="TRUE"/>' +
                    '</OrderBy>' +
                    '</Query>'
            };
            var query = _.extend({}, defaults, obj);

            //Mapping of SharePoint properties to SPServices properties
            var mapping = [
                ["query", "CAMLQuery"],
                ["viewFields", "CAMLViewFields"],
                ["rowLimit", "CAMLRowLimit"],
                ["queryOptions", "CAMLQueryOptions"],
                ["listItemID", "ID"]
            ];

            _.each(mapping, function (map) {
                if (query[map[0]] && !query[map[1]]) {
                    //Ensure SPServices properties are added in the event the true property name is used
                    query[map[1]] = query[map[0]];
                }
            });

            return query;
        }

        /**
         * @description Converts permMask into something usable to determine permission level for current user
         * @param {object} listItem (needs a permMask property)
         * @returns {object} property for each permission level identifying if current user has rights (true || false)
         * @see http://sympmarc.com/2009/02/03/permmask-in-sharepoint-dvwps/
         * @see http://spservices.codeplex.com/discussions/208708
         */
        function resolvePermissions(listItem) {
            var permissionsMask = listItem.permMask;
            var permissionSet = {};
            permissionSet.ViewListItems = (1 & permissionsMask) > 0;
            permissionSet.AddListItems = (2 & permissionsMask) > 0;
            permissionSet.EditListItems = (4 & permissionsMask) > 0;
            permissionSet.DeleteListItems = (8 & permissionsMask) > 0;
            permissionSet.ApproveItems = (16 & permissionsMask) > 0;
            permissionSet.OpenItems = (32 & permissionsMask) > 0;
            permissionSet.ViewVersions = (64 & permissionsMask) > 0;
            permissionSet.DeleteVersions = (128 & permissionsMask) > 0;
            permissionSet.CancelCheckout = (256 & permissionsMask) > 0;
            permissionSet.PersonalViews = (512 & permissionsMask) > 0;

            permissionSet.ManageLists = (2048 & permissionsMask) > 0;
            permissionSet.ViewFormPages = (4096 & permissionsMask) > 0;

            permissionSet.Open = (permissionsMask & 65536) > 0;
            permissionSet.ViewPages = (permissionsMask & 131072) > 0;
            permissionSet.AddAndCustomizePages = (permissionsMask & 262144) > 0;
            permissionSet.ApplyThemeAndBorder = (permissionsMask & 524288) > 0;
            permissionSet.ApplyStyleSheets = (1048576 & permissionsMask) > 0;
            permissionSet.ViewUsageData = (permissionsMask & 2097152) > 0;
            permissionSet.CreateSSCSite = (permissionsMask & 4194314) > 0;
            permissionSet.ManageSubwebs = (permissionsMask & 8388608) > 0;
            permissionSet.CreateGroups = (permissionsMask & 16777216) > 0;
            permissionSet.ManagePermissions = (permissionsMask & 33554432) > 0;
            permissionSet.BrowseDirectories = (permissionsMask & 67108864) > 0;
            permissionSet.BrowseUserInfo = (permissionsMask & 134217728) > 0;
            permissionSet.AddDelPrivateWebParts = (permissionsMask & 268435456) > 0;
            permissionSet.UpdatePersonalWebParts = (permissionsMask & 536870912) > 0;
            permissionSet.ManageWeb = (permissionsMask & 1073741824) > 0;
            permissionSet.UseRemoteAPIs = (permissionsMask & 137438953472) > 0;
            permissionSet.ManageAlerts = (permissionsMask & 274877906944) > 0;
            permissionSet.CreateAlerts = (permissionsMask & 549755813888) > 0;
            permissionSet.EditMyUserInfo = (permissionsMask & 1099511627776) > 0;
            permissionSet.EnumeratePermissions = (permissionsMask & 4611686018427387904) > 0;
            permissionSet.FullMask = (permissionsMask == 9223372036854775807);

            //Full Mask only resolves correctly for the Full Mask level
            // because so in that case set everything to true
            if (permissionSet.FullMask) {
                _.each(permissionSet, function (perm, key) {
                    permissionSet[key] = true;
                });
            }

            return permissionSet;

        }

        return {
            resolvePermissions: resolvePermissions,
            ListItem: ListItem,
            Model: Model,
            Query: Query
        };
    });
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
/*!
 * AngularJS Round Progress Directive
 * Original Work: Stephane Begaudeau
 * jQuery and IE8 compatibility enhancements: Scott Hatcher
 */
angular.module('angular-round-progress', []).directive('roundProgress', [function () {
    return {
        restrict: "A",
        replace: true,
        scope: {
            ngOptions: '=',
            ngModel: '='
        },
        link: function(scope, element, attrs) {
            var node = element[0];

            var defaults = {
                width: 400,
                height: 400,
                circle: {
                    inner: {
                        width: 5,
                        radius: 70,
                        foregroundColor: '#505769'
                    },
                    outer: {
                        width: 20,
                        radius: 100,
                        backgroundColor: '#505769',
                        foregroundColor: '#12eeb9'
                    }
                },
                label: {
                    color: '#12eeb9',
                    font: '50pt "Arial"' // Need to have the font name in extra layer of quotes in IE8
                }
            };

            var options = {};

            //Include any custom options
            jQuery.extend(true, options, defaults, scope.ngOptions || {});

            var canvas = document.createElement('canvas');

            node.appendChild(canvas);

            if (typeof(G_vmlCanvasManager) !== 'undefined') {
                G_vmlCanvasManager.initElement(canvas);
            }

            canvas.setAttribute('width', options.width.toString());
            canvas.setAttribute('height', options.height.toString());
            canvas.setAttribute('ng-model', scope.ngModel);

            scope.$watch('ngModel', function (newValue, oldValue) {
                // Create the content of the canvas
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, options.width, options.height);

                // The "background" circle
                var x = options.width / 2;
                var y = options.height / 2;
                ctx.beginPath();
                ctx.arc(x, y, options.circle.outer.radius, 0, Math.PI * 2, false);
                ctx.lineWidth = options.circle.outer.width;
                ctx.strokeStyle = options.circle.outer.backgroundColor;
                ctx.stroke();

                // The inner circle
                ctx.beginPath();
                ctx.arc(x, y, options.circle.inner.radius, 0, Math.PI * 2, false);
                ctx.lineWidth = options.circle.inner.width;
                ctx.strokeStyle = options.circle.inner.foregroundColor;
                ctx.stroke();

                // The inner number
                ctx.font = options.label.font;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = options.label.color;
                ctx.fillText(newValue.label, x, y);

                // The "foreground" circle
                var startAngle = -(Math.PI / 2);
                var endAngle = ((Math.PI * 2 ) * newValue.percentage) - (Math.PI / 2);
                var anticlockwise = false;
                ctx.beginPath();
                ctx.arc(x, y, options.circle.outer.radius, startAngle, endAngle, anticlockwise);
                ctx.lineWidth = options.circle.outer.width;
                ctx.strokeStyle = options.circle.outer.foregroundColor;
                ctx.stroke();
            }, true);
        }
    };
}]);

angular.module('OneApp')
    .directive('oaSelect', function ($timeout) {
        return {
            restrict: "A",
            replace: true,
            template: '' +
                '<span class="ng-cloak">\n' +
                '   <span ng-if="!multi">\n' +
                '       <select class="form-control" ng-model="state.singleSelectID"\n ' +
                '           ng-change="updateSingleModel()" style="width: 100%" ng-disabled="ngDisabled"\n ' +
                '           ng-options="lookup.id as lookup[state.lookupField] for lookup in arr">\n ' +
                '       </select>\n' +
                '   </span>\n' +
                '   <span ng-if="multi">\n' +
                '       <select multiple ui-select2 ng-model="state.multiSelectIDs"\n' +
                '           ng-change="updateMultiModel()" style="width: 100%;" ng-disabled="ngDisabled">\n' +
                '               <option></option>\n' +
                '               <option ng-repeat="lookup in arr" value="{{ lookup.id }}"\n' +
                '                   ng-bind="lookup[state.lookupField]">&nbsp;</option>\n' +
                '       </select>\n' +
                '   </span>\n' +
                '</span>\n' +
                '',
            scope: {
                bindedField: '=',   //The field on the model to bind to
                multi: '=',         //Single select if not set or set to false
                arr: '=',           //Array of lookup options
                lookupValue: '=',   //Field name to map the lookupValue to (default: 'title')
                changed: '=',       //Optional reference to a change notifier function
                ngDisabled: '='     //Pass through to disable control using ng-disabled on element if set
            },
            link: function (scope, element, attrs) {

                scope.state = {
                    multiSelectIDs: [],
                    singleSelectID: ''
                };

                //Default to title field if not provided
                scope.state.lookupField = scope.lookupValue || 'title';

                $timeout(function() {

                    if (scope.multi) {
                        //Multi Select Mode
                        //Set the string version of id's to allow multi-select control to work properly
                        _.each(scope.bindedField, function (selectedLookup) {
                            //Push id as a string to match what Select2 is expecting
                            scope.state.multiSelectIDs.push(selectedLookup.lookupId.toString());
                        });
                    } else {
                        //Single Select Mode
                        if (_.isObject(scope.bindedField) && scope.bindedField.lookupId) {
                            //Set the selected id as string
                            scope.state.singleSelectID = scope.bindedField.lookupId;
                        }
                    }
                }, 0);

                //Optionally callback if provided
                if(_.isFunction(scope.changed)) {
                    scope.$watch('bindedField', function(newVal, oldVal) {
                        if(newVal === oldVal) return;
                        scope.changed();
                    }, true);
                }

                var buildLookupObject = function(stringId) {
                    var intID = parseInt(stringId, 10);
                    var match = _.findWhere(scope.arr, {id: intID});
                    return { lookupId: intID, lookupValue: match[scope.state.lookupField] };
                };

                //Todo: Get this hooked up to allow custom function to be passed in instead of property name
                scope.generateDisplayText = function(item) {
                    if(_.isFunction(scope.state.lookupField)) {
                        //Passed in a reference to a function to generate the select display text
                        return scope.state.lookupField(item);
                    } else if(_.isString(scope.state.lookupField)){
                        //Passed in a property name on the item to use
                        return item[scope.state.lookupField];
                    } else {
                        //Default to the title property of the object
                        return item.title;
                    }
                };

                scope.updateMultiModel = function () {
                    //Ensure field being binded against is array
                    if (!_.isArray(scope.bindedField)) {
                        scope.bindedField = [];
                    }
                    //Clear out existing contents
                    scope.bindedField.length = 0;
                    //Push formatted lookup object back
                    _.each(scope.state.multiSelectIDs, function (stringId) {
                        scope.bindedField.push(buildLookupObject(stringId));
                    });
                };

                scope.updateSingleModel = function () {
                    //Create an object with expected lookupId/lookupValue properties
                    scope.bindedField = buildLookupObject(scope.state.singleSelectID);
                };
            }
        };
    });
angular.module('OneApp')
    .directive('oaAttachments', function ($sce) {
        return {
            restrict: "A",
            replace: true,
            templateUrl: 'bower_components/one-app-core/scripts/directives/oa_attachments/oa_attachments_tmpl.html',
            scope: {
                listItem: "=",      //List item the attachments belong to
                changeEvent: '='    //Optional - called after an attachment is deleted
            },
            link: function (scope, element, attrs) {

                scope.attachments = [];
                scope.state = {
                    ready: false
                };

                scope.refresh = function () {
                    if (!scope.$$phase) {
                        scope.$apply();
                    }
                };

                function resetSrc() {
                    if (_.isFunction(scope.changeEvent)) {
                        scope.changeEvent();
                    }
                    //Reset iframe
                    element.find('iframe').attr('src', element.find('iframe').attr('src'));
                }

                var listItemModel = scope.listItem.getModel();
                var uploadUrl = listItemModel.list.webURL + '/_layouts/Attachfile.aspx?ListId=' +
                    listItemModel.list.guid + '&ItemId=' + scope.listItem.id + '&IsDlg=1';

                scope.trustedUrl = $sce.trustAsResourceUrl(uploadUrl);

                //Pull down all attachments for the current list item
                var fetchAttachments = function () {
                    toastr.info("Checking for attachments")
                    scope.listItem.getAttachmentCollection().then(function (attachments) {
                        scope.attachments.length = 0;
                        //Push any new attachments into the existing array to prevent breakage of references
                        Array.prototype.push.apply(scope.attachments, attachments);
                    });
                };

                //Instantiate request
                fetchAttachments();

                scope.fileName = function (attachment) {
                    var index = attachment.lastIndexOf("/") + 1;
                    return attachment.substr(index);
                };

                scope.deleteAttachment = function (attachment) {
                    var confirmation = window.confirm("Are you sure you want to delete this file?");
                    if (confirmation) {
                        toastr.info("Negotiating with the server");
                        scope.listItem.deleteAttachment(attachment).then(function () {
                            toastr.success("Attachment successfully deleted");
                            fetchAttachments();
                            if (_.isFunction(scope.changeEvent)) {
                                scope.changeEvent();
                            }
                        });
                    }
                };

                //Run when the iframe url changes and fully loaded
                element.find('iframe').bind('load', function (event) {
                    scope.state.ready = true;
                    scope.refresh();
                    var iframe = $(this).contents();

                    if (iframe.find("#CancelButton").length < 1) {
                        //Upload complete, reset iframe
                        toastr.success("File successfully uploaded");
                        resetSrc();
                        fetchAttachments();
                        if (_.isFunction(scope.changeEvent)) {
                            scope.changeEvent();
                        }

                    } else {
                        //Hide the standard cancel button
                        iframe.find("#CancelButton").hide();
                        iframe.find(".ms-dialog").css({height: '95px'});

                        //Style OK button
                        iframe.find("input[name$='Ok']").css({float: 'left'}).click(function (event) {
                            //Click handler
                            toastr.info("Please wait while the file is uploaded");
                        });

                        iframe.find("input[name$='$InputFile']").attr({'size': 40});

                        //Style iframe to prevent scroll bars from appearing
                        iframe.find("#s4-workspace").css({
                            'overflow-y': 'hidden',
                            'overflow-x': 'hidden'
                        });

                        console.log("Frame Loaded");
                    }
                });

            }
        };
    });
angular.module('OneApp')
    .directive('oaComments', function ($sce, $timeout, commentsModel, config) {
        return {
            restrict: "A",
            replace: true,
            templateUrl: 'bower_components/one-app-core/scripts/directives/oa_comments/oa_comments_tmpl.html',
            scope: {
                listItem: "=",      //List item the attachments belong to
                changeEvent: '='    //Optional - called after an attachment is deleted
            },
            link: function (scope, element, attrs) {

                scope.state = {
                    ready: false,
                    tempComment: '',
                    tempResponse: '',
                    respondingTo: ''
                };

                scope.comments = scope.listItem.comments || null;

                //Helper to force digest
                scope.refresh = function () {
                    if (!scope.$$phase) {
                        scope.$apply();
                    }
                };

                scope.clearTempVars = function () {
                    $timeout(function() {
                        scope.state.respondingTo = '';
                        scope.state.tempResponse = '';
                        scope.state.tempComment = '';
                    });
                };

                scope.createNewComment = function () {
                    toastr.info("Negotiating with the server");

                    if (scope.comments) {
                        //Comment already exists so no need to create new one
                        scope.comments.createResponse(scope.state.tempComment).then(function (response) {
                            scope.comments = response;
                            scope.clearTempVars();
                        });
                    } else {
                        //Creating a new list item
                        commentsModel.createComment(scope.listItem, scope.state.tempComment).then(function (response) {
                            scope.comments = response;
                            scope.clearTempVars();
                        });
                    }
                };

                scope.createResponse = function (comment) {
                    toastr.info("Negotiating with the server");
                    comment.createResponse(scope.state.tempResponse).then(function () {
                        scope.clearTempVars();
                    });
                };

                scope.deleteComment = function (comment) {
                    var parent = comment.parentComment();
                    var root = comment.rootComment();

                    var confirmation = window.confirm("Are you sure you want to delete this comment?");
                    if (confirmation) {
                        toastr.info("Negotiating with the server");
                        if (parent === root && parent.thread.length === 1) {
                            //Delete the list item because it's at the root and there are no others
                            return root.deleteItem().then(function () {
                                //Remove reference to the comment
                                delete scope.comments;
                                delete scope.listItem.comments;
                                toastr.success("Comment successfully deleted");
                            }, function () {
                                toastr.error("There was a problem deleting this comment.  Please try again.");
                            });
                        } else {
                            return root.saveChanges().then(function () {
                                //Just remove this comment from the thread
                                var commentIndex = parent.thread.indexOf(comment);
                                parent.thread.splice(commentIndex, 1);
                                toastr.success("Comment successfully deleted");
                            }, function () {
                                toastr.error("There was a problem deleting this comment.  Please try again.");
                            });
                        }
                    }
                };

                //Pull down all comments for the current list item
                var fetchComments = function () {
                    toastr.info("Checking for new comments");
                    scope.listItem.fetchComments().then(function (comments) {
                        $timeout(function () {
                            if (config.offline && !scope.listItem.comments) {
                                //Just return first comment
                                scope.comments = comments[0];
                            } else if (comments.length > 0) {
                                scope.comments = comments[0];
                            }

                            //Store updated comments on list item
                            scope.listItem.comments = scope.comments;

                            scope.state.ready = true;
                        });
                    });
                };

                fetchComments();

                commentsModel.sync.subscribeToChanges(function () {
                    //Ensure all updates to comment thread are displayed as they happen
//                    var localComments = commentsModel.checkForLocalComments(scope.listItem);
//                    if(localComments) {
//                        scope.comments = localComments;
//                        scope.listItem.comments = localComments;
//                    }
                    console.log("Comment change detected");
                });

            }
        };
    });
'use strict';

angular.module('OneApp')
    .controller('NavbarCtrl', function ($scope, $route, $location, queue) {

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
            if (!$scope.$$phase) {
                $scope.$apply();
            }
        });
    });
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
'use strict';

angular.module('OneApp')
    .controller('generateOfflineCtrl', function ($scope, $q, dataService, config) {
        $scope.state = {
            siteUrl: config.defaultUrl,
            query: '',
            itemLimit: 0,
            selectedList: '',
            availableListFields: [],
            selectedListFields: [],
            xmlResponse: ''
        };

        $scope.refresh = function () {
            if (!$scope.$$phase) {
                $scope.$apply();
            }
        };

        $scope.listCollection = [];

        $scope.getLists = function() {
            dataService.getCollection({
                operation: "GetListCollection",
                webURL: $scope.state.siteUrl
            }).then(function(dataArray) {
                    $scope.listCollection.push.apply($scope.listCollection, dataArray);
                    toastr.info($scope.listCollection.length + ' lists/libraries identified.');
                });
        };

        $scope.getLists();

        $scope.getXML = function () {

            $scope.listCollection.length = 0;

            var payload = {
                operation: "GetListItems",
                listName: $scope.state.selectedList.Name,
                CAMLRowLimit: $scope.state.itemLimit,
                webURL: $scope.state.siteUrl
            };

            if($scope.state.selectedListFields.length > 0) {
                payload.CAMLViewFields = "<ViewFields>";
                _.each($scope.state.selectedListFields, function(fieldName) {
                    payload.CAMLViewFields += "<FieldRef Name='" + fieldName + "' />";
                });
                payload.CAMLViewFields += "</ViewFields>";
            }

            //Add query to payload if it's supplied
            if ($scope.state.query.length > 0) {
                payload.CAMLQuery = $scope.state.query;
            }

            var promise = $().SPServices(payload);

            promise.done(function (xData, status, response) {
                //Update the visible XML response
                $scope.state.xmlResponse = response.responseText;
                $scope.refresh();
            });
        };

        $scope.lookupListFields = function() {
            console.log("Looking up List Fields");
            $scope.state.availableListFields.length = 0;
            $scope.state.selectedListFields.length = 0;
            if(_.isObject($scope.state.selectedList) && $scope.state.selectedList.Title) {
                dataService.getList({
                    webURL: $scope.state.siteUrl,
                    listName: $scope.state.selectedList.Name
                }).then(function(dataArray) {
                        $scope.state.availableListFields.push.apply(
                            $scope.state.availableListFields, dataArray
                        );
                        toastr.info($scope.state.availableListFields.length + " fields found.")
                    });
            }
        };

        $scope.$watch('state.selectedList', function(newVal, oldVal) {
            if(!newVal) return;
            $scope.lookupListFields();
            console.log(newVal);
        });
    });
'use strict';

angular.module('OneApp')
    .controller('groupManagerCtrl', function ($scope, $q, $timeout, $filter, ngTableParams, config, dataService) {
        /** 1. Create deferred object which is resolved one all models are ready */
        /** 2. Decorates the $scope with helper methods like "$scope.refresh()" */
        /** 3. Creates pointers on the $scope to each model.data array (ex: adds $scope.personnel for personnelModel) */
        $scope.ready = dataService.registerModels($scope, []);

        $scope.siteCollectionUsers = [];
        $scope.siteCollectionGroups = [];
        $scope.availableOptions = [];
        $scope.assignedOptions = [];

        $scope.state = {
            activeTab: "Users",
            siteUrl: $().SPServices.SPGetCurrentSite(),
            selectedUser: '',
            selectedGroup: '',
            selectedAvailableOptions: '',
            selectedAssignedOptions: '',
            userFilter: '',
            groupFilter: ''
        };

        $scope.tabContents = {};

        var buildInputs = function (assignedItems) {
            var map = [];
            var available = [];
            var assigned = [];

            var fullList = $scope.state.activeTab === "Users" ?
                $scope.siteCollectionUsers :
                $scope.siteCollectionGroups;

            $scope.state.selectedAvailableOptions = '';
            $scope.state.selectedAssignedOptions = '';

            //Create a quick map to speed up checking in future
            _.each(assignedItems, function (item) {
                map.push(item.ID);
            });

            _.each(fullList, function (item) {
                if (map.indexOf(item.ID) > -1) {
                    //Group already assigned
                    assigned.push(item);
                } else {
                    available.push(item);
                }
            });
            $scope.availableOptions.length = 0;
            $scope.assignedOptions.length = 0;
            Array.prototype.push.apply($scope.availableOptions, available);
            Array.prototype.push.apply($scope.assignedOptions, assigned);
            console.log($scope);
        };

        $scope.updateAvailableGroups = function () {
            toastr.info("Retrieving an updated list of groups for the current user");
            dataService.getCollection({
                webUrl: $scope.state.siteUrl,
                operation: "GetGroupCollectionFromUser",
                userLoginName: $scope.state.selectedUser.LoginName
            }).then(function (response) {
                buildInputs(response);
            });
        };

        $scope.updateAvailableUsers = function () {
            toastr.info("Retrieving an updated list of users for the current group");
            dataService.getCollection({
                webUrl: $scope.state.siteUrl,
                groupName: $scope.state.selectedGroup.Name,
                operation: "GetUserCollectionFromGroup"
            }).then(function (response) {
                buildInputs(response);
            });
        };

        //Initialize with default values
        $scope.tabContents = {
            labels: {
                select: 'Select a User:',
                available: 'Available Groups',
                assigned: 'Assigned Groups'
            },
            model: $scope.state.selectedGroup,
            options: $scope.siteCollectionGroups,
            description: 'This page was created to make the process of managing users/groups within the site ' +
                'collection more manageable.  When a user is selected, the available groups are displayed on the ' +
                'left and the groups that the user is currently a member of will show on the right. Selecting ' +
                'multiple groups is supported.'
        };

        $scope.updateTab = function (tab) {
            if (tab === 'Groups') {
                $scope.state.activeTab = "Groups";
                $scope.tabContents = {
                    labels: {
                        select: 'Select a User:',
                        available: 'Available Groups',
                        assigned: 'Assigned Groups'
                    },
                    model: $scope.state.selectedGroup,
                    options: $scope.siteCollectionGroups,
                    description: 'This page was created to make the process of managing users/groups within the site ' +
                        'collection more manageable.  When a user is selected, the available groups are displayed on the ' +
                        'left and the groups that the user is currently a member of will show on the right. Selecting ' +
                        'multiple groups is supported.'
                };
                $scope.updateAvailableGroups();
            } else {
                $scope.state.activeTab = 'Users';
                $scope.tabContents = {
                    labels: {
                        select: 'Select a Group:',
                        available: 'Available Users',
                        assigned: 'Assigned Users'
                    },
                    model: $scope.state.selectedUser,
                    options: $scope.siteCollectionUsers,
                    description: 'This tab will allow you to quickly assign multiple users to a selected group.'
                };
                $scope.updateAvailableUsers();
            }
        };

        $scope.userDetailsLink = function(user) {
            $scope.state.selectedUser = user;
            $scope.state.activeTab = "Groups";
            $scope.updateAvailableGroups();
        };

        $scope.groupDetailsLink = function(group) {
            $scope.state.selectedGroup = group;
            $scope.state.activeTab = "Users";
            $scope.updateAvailableUsers();
        };

        $scope.updatePermissions = function (operation) {
            var destination = $scope.assignedOptions;
            var source = $scope.availableOptions;
            var selectedObjects = $scope.state.selectedAvailableOptions;

            if (operation !== "AddUserToGroup") {
                destination = $scope.availableOptions;
                source = $scope.assignedOptions;
                selectedObjects = $scope.state.selectedAssignedOptions;
            }

            if (!selectedObjects.length) {
                toastr.warning("Please make a selection");
            } else {
                toastr.info("Communicating with the server");
                var queue = [];
                _.each(selectedObjects, function (item) {
                    var deferred = $q.defer();

                    if (config.offline) {
                        //Simulate an async call
                        $timeout(function () {
                            //Push option to look like they've been assigned
                            destination.push(item);
                            //Remove from the available side
//                            source.splice(selectedObjects.indexOf(item), 1);
                            source.splice(source.indexOf(item), 1);
                        })
                    } else {

                        var groupName;
                        var userLoginName;

                        if ($scope.state.activeTab === 'Groups') {
                            groupName = item.Name;
                            userLoginName = $scope.state.selectedUser.LoginName;
                        } else {
                            groupName = $scope.state.selectedGroup.Name;
                            userLoginName = item.LoginName;
                        }

                        dataService.serviceWrapper({
                            webUrl: $scope.state.siteUrl,
                            filterNode: "User",   //Look for all xml "User" nodes and convert those in to JS objects
                            operation: operation, //AddUserToGroup || RemoveUserFromGroup"
                            groupName: groupName,
                            userLoginName: userLoginName
                        }).then(function(response) {
                            deferred.resolve(response);
                        });
                    }

                    queue.push(deferred.promise);
                });
                $scope.state.selectedAvailableOptions = '';
                $scope.state.selectedAssignedOptions = '';

                //Resolved when all promises complete
                $q.all(queue).then(function (responses) {
                    toastr.success(operation === "AddUserToGroup" ?
                        "User successfully added":
                        "User successfully removed");
                    if (!config.offline) {
                        //Retrieve updated value from the server
                        if($scope.state.activeTab === "Users") {
                            $scope.updateAvailableUsers();
                        } else {
                            $scope.updateAvailableGroups();
                        }
                    }
                }, function (outcome) {
                    toastr.error("There was a problem removing the user");
                });
            }
        };

        $scope.usersTable = new ngTableParams({
            page: 1,            // show first page
            count: 30,           // count per page
            sorting: {
                title: 'asc'
            }
        }, {
            total: $scope.siteCollectionUsers.length, // length of data
            getData: function ($defer, params) {
                console.time("Filtering");
                // use build-in angular filter
                var orderedData = $scope.siteCollectionUsers;
                orderedData = $filter('filter')(orderedData, function(record) {
                    var match = false;

                    if($scope.state.userFilter === '') {
                        return true;
                    }
                    var textFields = ['ID', 'Name', 'Email'];
                    var searchStringLowerCase = $scope.state.userFilter.toLowerCase();
                    _.each(textFields, function(fieldName) {
                        if(record[fieldName].toLowerCase().indexOf(searchStringLowerCase) !== -1) {
                            match = true;
                        }
                    });
                    return match;
                });

                params.total(orderedData.length);
                $defer.resolve(orderedData.slice((params.page() - 1) * params.count(), params.page() * params.count()));
            }
        });

        $scope.groupsTable = new ngTableParams({
            page: 1,            // show first page
            count: 30,           // count per page
            sorting: {
                title: 'asc'
            }
        }, {
            total: $scope.siteCollectionGroups.length, // length of data
            getData: function ($defer, params) {
                console.time("Filtering");
                // use build-in angular filter
                var orderedData = $scope.siteCollectionGroups;
                orderedData = $filter('filter')(orderedData, function(record) {
                    var match = false;

                    if($scope.state.groupFilter === '') {
                        return true;
                    }
                    var textFields = ['ID', 'Name', 'Email'];
                    var searchStringLowerCase = $scope.state.groupFilter.toLowerCase();
                    _.each(textFields, function(fieldName) {
                        if(record[fieldName].toLowerCase().indexOf(searchStringLowerCase) !== -1) {
                            match = true;
                        }
                    });
                    return match;
                });

                params.total(orderedData.length);
                $defer.resolve(orderedData.slice((params.page() - 1) * params.count(), params.page() * params.count()));
            }
        });

        var getUserCollection = function() {
            var deferred = $q.defer();
            dataService.getCollection({
                webUrl: $scope.state.siteUrl,
                operation: 'GetUserCollectionFromSite'
            }).then(function (response) {
                _.each(response, function (user) {
                    if (user.LoginName.indexOf("0#.w|navy") > 0) {
                        $scope.siteCollectionUsers.push(user);
                    }
                });
                $scope.state.selectedUser = $scope.siteCollectionUsers[0];
//                $scope.updateAvailableGroups();
                deferred.resolve($scope.siteCollectionUsers);
            });
            return deferred.promise;
        };

        var getGroupCollection = function() {
            var deferred = $q.defer();
            dataService.getCollection({
                webUrl: $scope.state.siteUrl,
                operation: "GetGroupCollectionFromSite"
            }).then(function (response) {
                Array.prototype.push.apply($scope.siteCollectionGroups, response);
                $scope.state.selectedGroup = $scope.siteCollectionGroups[0];
                deferred.resolve($scope.siteCollectionGroups);
            });
            return deferred.promise;
        };


        /** All logic dependent on model data should be inlcuded in the return statement */
        return $q.all(getUserCollection(), getGroupCollection()).then(function() {
            $scope.updateAvailableUsers();
            $scope.updateTab();
            console.log($scope);
        });
    });