/*
 * Copyright (c) 2015 Adobe Systems Incorporated. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var URL = require("url");

function rate(entryRequest, request) {
    var points = 0;
    var name;

    // method, host and pathname must match
    if (
        entryRequest.method !== request.method ||
        (request.parsedUrl.host !== null && entryRequest.parsedUrl.host !== request.parsedUrl.host) ||
        entryRequest.parsedUrl.pathname !== request.parsedUrl.pathname
    ) {
        return 0;
    }

    // One point for matching above requirements
    points += 1;

    // each query
    var entryQuery = entryRequest.parsedUrl.query;
    var requestQuery = request.parsedUrl.query;
    if (entryQuery && requestQuery) {
        for (name in requestQuery) {
            if (entryQuery[name] === undefined) {
                points -= 0.5;
            } else {
                points += stripProtocol(entryQuery[name]) === stripProtocol(requestQuery[name]) ? 1 : 0;
            }
        }

        for (name in entryQuery) {
            if (requestQuery[name] === undefined) {
                points -= 0.5;
            }
        }
    }

    // each header
    var entryHeaders = entryRequest.indexedHeaders;
    var requestHeaders = request.headers;
    for (name in requestHeaders) {
        if (entryHeaders[name]) {
            points += stripProtocol(entryHeaders[name]) === stripProtocol(requestHeaders[name]) ? 1 : 0;
        }
        // TODO handle missing headers and adjust score appropriately
    }

    return points;
}

function stripProtocol(string) {
    if (typeof string === "string") {
        return string.replace(/^https?/, "");
    } else {
        return string;
    }
}

function indexHeaders(entryHeaders) {
    var headers = {};
    entryHeaders.forEach(function (header) {
        headers[header.name.toLowerCase()] = header.value;
        // TODO handle multiple of the same named header
    });
    return headers;
}

function bestEntryForRequestInCollection(request, entryCollection) {
    var topPoints = 0;
    var topEntry;
    var topEntryIndex;
    var i;

    var entry;
    var numEntries = entryCollection.length;
    for (i = 0; i < numEntries; i++) {
        entry = entryCollection[i];
        if (!entry.request.parsedUrl) {
            entry.request.parsedUrl = URL.parse(entry.request.url, true);
        }
        if (!entry.request.indexedHeaders) {
            entry.request.indexedHeaders = indexHeaders(entry.request.headers);
        }
        var points = rate(entry.request, request);
        if (points > topPoints) {
            topPoints = points;
            topEntry = entry;
            topEntryIndex = i;
        }
    }

    return [topEntry, topEntryIndex];
};

function makeHeuristicGuesser(entries) {
    var unreturnedEntries = entries;
    var returnedEntires = [];

    return {
        bestEntryForRequest: function (request) {

            // First select the best un-returned match from the collection.
            // If we can't find any matches in this collection, then use
            // the best possible match from the collection of
            // already returned entries.
            var [bestEntry, bestEntryIndex] = bestEntryForRequestInCollection(request, unreturnedEntries);

            if (bestEntry !== undefined) {
                // Remove the now-being-returned entry from the "not-yet returned"
                // array, and move it to the "has been returned" array.
                unreturnedEntries.splice(bestEntryIndex, 1);
                returnedEntires.push(bestEntry);
                return bestEntry;
            }

            [bestEntry, bestEntryIndex] = bestEntryForRequestInCollection(request, returnedEntires);
            return bestEntry;
        },
    };
};

module.exports.makeHeuristicGuesser = makeHeuristicGuesser;