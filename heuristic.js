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

function rate(maxTime, lastReturnedEntry, entry, request) {
    var points = 0;
    var name;
    var entryRequest = entry.request;

    // method, host and pathname must match
    if (
        request.method !== entryRequest.method ||
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
                points += entryQuery[name] === requestQuery[name] ? 1 : 0;
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

    // Favor entries that happened as soon as possible after the last
    // entry that was returned.  Award [-0.5, 3] points: -0.5 if the
    // considered entry occured before the request, and between [3, 0],
    // linerally scaled, for how long after the request the occured
    // (3 points for the entry being returned after the last response,
    // and 0 points for being the furtherest away response in time).
    // If we've never returned an entry, then ignore this check.
    //
    // @todo consider other scaling systems, this is a lot of guesses...
    var tsDiff;
    var tsDiffRange;
    if (lastReturnedEntry !== undefined) {
        if (entry.receivedTS < lastReturnedEntry.receivedTS) {
            points -= 0.5;
        } else {
            tsDiff = entry.receivedTS - lastReturnedEntry.receivedTS;
            tsDiffRange = maxTime - lastReturnedEntry.receivedTS;
            points += (tsDiff / tsDiffRange) * 3;
        }    
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

function bestEntryForRequestInCollection(maxTime, lastReturnedEntry, request, entryCollection) {
    var rateBound = rate.bind(undefined, maxTime, lastReturnedEntry);
    var topPoints = 0;
    var topEntry;
    var topEntryIndex;
    var i;
    var pointsForEntry;

    var entry;
    var numEntries = entryCollection.length;
    for (i = 0; i < numEntries; i++) {
        entry = entryCollection[i];
        pointsForEntry = rateBound(entry, request);
        if (pointsForEntry > topPoints) {
            topPoints = pointsForEntry;
            topEntry = entry;
            topEntryIndex = i;
        }
    }

    return [topEntry, topEntryIndex];
};

function makeHeuristicGuesser(entries) {
    // Preprocess all entries once, to make all future comparisons
    // quicker.
    var unreturnedEntries = entries.map(function (entry) {
        entry.request.parsedUrl = URL.parse(entry.request.url, true);
        entry.request.indexedHeaders = indexHeaders(entry.request.headers);
        entry.receivedTS = Date.parse(entry.startedDateTime);
        return entry;
    });

    var numEntries = unreturnedEntries.length;

    // Track the last HAR entry that was returned.  Will be undefined
    // until an entry has been returned.
    var lastReturnedEntry;

    // Time stamp of the last request recorded in the HAR, used to
    // more highly weigh responses that occur closer to incoming
    // new requests.
    var maxRequestTS = unreturnedEntries[numEntries - 1].receivedTS;

    // Array of entries that have already been returned to the client.
    // Will be a subset of all entries that occur in the HAR file. 
    var returnedEntires = [];

    var bestEntryForRequestInCollectionBound = bestEntryForRequestInCollection.bind(
        undefined,
        maxRequestTS
    );

    return {
        bestEntryForRequest: function (request) {
            request.parsedUrl = URL.parse(request.url, true);

            // First select the best un-returned match from the collection.
            // If we can't find any matches in this collection, then use
            // the best possible match from the collection of
            // already returned entries.
            var [bestEntry, bestEntryIndex] = bestEntryForRequestInCollectionBound(
                lastReturnedEntry,
                request,
                unreturnedEntries
            );

            if (bestEntry !== undefined) {
                // Remove the now-being-returned entry from the "not-yet returned"
                // array, and move it to the "has been returned" array.
                unreturnedEntries.splice(bestEntryIndex, 1);
                returnedEntires.push(bestEntry);
                lastReturnedEntry = bestEntry;
                return bestEntry;
            }

            [bestEntry, bestEntryIndex] = bestEntryForRequestInCollectionBound(
                lastReturnedEntry,
                request,
                returnedEntires
            );
            lastReturnedEntry = bestEntry || lastReturnedEntry;
            return bestEntry;
        },
    };
};

module.exports.makeHeuristicGuesser = makeHeuristicGuesser;