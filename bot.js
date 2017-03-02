let io = require('socket.io-client');

let socket = io('http://botws.generals.io');

socket.on('disconnect', function() {
    console.error('Disconnected from server.');
    process.exit(1);
});

socket.on('connect', function() {
    console.log('Connected to server.');

    /* Don't lose this user_id or let other people see it!
     * Anyone with your user_id can play on your bot's account and pretend to be your bot.
     * If you plan on open sourcing your bot's code (which we strongly support), we recommend
     * replacing this line with something that instead supplies the user_id via an environment letiable, e.g.
     * let user_id = process.env.BOT_USER_ID;
     */
    let user_id = process.env.BOT_USER_ID;
    let username = '[Bot]ox';

    // Set the username for the bot.
    socket.emit('set_username', user_id, username);
    // Join a custom game and force start immediately.
    // Custom games are a great way to test your bot while you develop it because you can play against your bot!
    let custom_game_id = process.env.BOT_GAME_ID;
    //socket.emit('join_private', custom_game_id, user_id);
    socket.emit('join_1v1', user_id);
    //socket.emit('set_force_start', custom_game_id, true);
    //console.log('Joined custom game at http://bot.generals.io/games/' + encodeURIComponent(custom_game_id));
});

// Terrain Constants.
// Any tile with a nonnegative value is owned by the player corresponding to its value.
// For example, a tile with value 1 is owned by the player with playerIndex = 1.
let TILE_EMPTY = -1;
let TILE_MOUNTAIN = -2;
let TILE_FOG = -3;
let TILE_FOG_OBSTACLE = -4; // Cities and Mountains show up as Obstacles in the fog of war.

// Game data.
let playerIndex;
let turn;
let generals;
let cities = [];
let map = [];
let terrain = [];
let armies = [];
//map coords
let ownTiles = [];
let border = [];
let ownGeneral = 0;
let width = 0;
let height = 0;
let size = 0;
let initialised = false;
let bfsed = false;

let enemyG = -1;

let lastMoved = -1;

let chat_room;

let levels = [];
let levelOrderedTiles = [];
let wayMetrix = [];

let lastFrom = -1;


socket.on('game_start', function(data) {
    // Get ready to start playing the game.
    playerIndex = data.playerIndex;
    chat_room = data.chat_room;
    let replay_url = 'http://bot.generals.io/replays/' + encodeURIComponent(data.replay_id);
    console.log('Game starting! The replay will be available after the game at ' + replay_url);
    socket.emit('chat_message', chat_room, 'Hi sweetie <3');
});

socket.on('game_update', gameUpdate);

function gameUpdate(data) {
    console.log(data.turn);
    if(!initialised){
        socket.emit('chat_message', chat_room, 'ASL?');
        initialise(data);
    }
    // Patch the city and map diffs into our local letiables.
    cities = patch(cities, data.cities_diff);
    map = patchMap(map, data.map_diff);

    for(let i = 0; i < data.generals.length; i++){
        if(generals[i] === -1 && data.generals[i] !== -1){
            generals[i] = data.generals[i];
            if(i !== playerIndex){
                enemyG = generals[i];
            }
        }
    }
    turn = data.turn;
    ownGeneral = generals[playerIndex];

    console.log(ownTiles.length);

    // The next |size| terms are army values.
    // armies[0] is the top-left corner of the map.
    armies = map.slice(2, size + 2);

    // The last |size| terms are terrain values.
    // terrain[0] is the top-left corner of the map.
    terrain = map.slice(size + 2, map.length);

    if(!bfsed) {
        bfs(ownGeneral, -1);
        wayMetric();
        bfsed = true;
    }
    //printArr(levels);
    //console.log();
    //printArr(wayMetrix);

    //let maxArmies = 0;
    //let maxTile = -1;

    if(turn >= 24) {

        let ownTileRating = [];
        for (let i = 0; i < ownTiles.length; i++) {
            let element = ownTiles[i];
            ownTileRating[i] = 0;
            if (element === ownGeneral) {
                ownTileRating[i] -= 15;
            }
            if (armies[element] < 2) {
                ownTileRating[i] -= 10000;
            }
            else {
                ownTileRating[i] += armies[element];
            }
            let neighbors = getNeighbors(element);
            neighbors.forEach(function (neighbor) {
                if (terrain[neighbor] >= -1 && terrain[neighbor] != playerIndex) {
                    ownTileRating[i] += 25;
                }
            });
            /**if (armies[element] > maxArmies) {
            maxArmies = armies[element];
            maxTile = element;
        }*/
        }
        let fromOwnTile = getMaxArrIndex(ownTileRating);
        let fromIndex = ownTiles[fromOwnTile];
        let neighbors = getNeighbors(fromIndex);
        let neighborRating = [];
        let goodMoves = [];
        if(enemyG !== -1){
            bfs(enemyG, fromIndex);
            goodMoves = getForelastLevel(levels, fromIndex);
        }
        for (let i = 0; i < neighbors.length; i++) {
            neighborRating[i] = 0;
            let neighbor = neighbors[i];
            if(neighbor == lastFrom){
                neighborRating[i] -= 1000000;
            }
            else if(neighbor === enemyG && armies[neighbor] < armies[fromIndex]){
                neighborRating[i] += 9999999999999;
            }
            //Attack the general
            if(enemyG !== -1 && armies[enemyG] < armies[fromIndex]){
                if(goodMoves.includes(neighbor)){
                    neighborRating[i] += 2000000;
                }
            }
            //City
            /**if(cities.indexOf(neighbor) >= 0){
            if(terrain[neighbor] !== playerIndex){
                if(armies[neighbor] >= armies[fromIndex]){
                    neighborRating[i] -= 10000;
                }
            }
        }*/
            //Mountain
            if (terrain[neighbor] === -2) {
                neighborRating[i] -= 1000000000000;
            }
            //Free
            else if (terrain[neighbor] === -1) {
                //city/grey
                if (armies[neighbor] > 0){
                    neighborRating[i] += (armies[fromIndex] - armies[neighbor] - 1) * 100000;
                }
                else {
                    neighborRating[i] += 150000;
                    if (wayMetrix[neighbor] < wayMetrix[fromIndex]) {
                        neighborRating[i] += wayMetrix[neighbor] / wayMetrix[ownGeneral] * 100000;
                    }
                }
            }
            //Enemy
            else if (armies[neighbor] >= 0 && terrain[neighbor] != playerIndex) {
                neighborRating[i] += (armies[fromIndex] - armies[neighbor] - 1) * 200000;
            }
            //Own
            else if (armies[neighbor] >= 0 && terrain[neighbor] == playerIndex) {
                neighborRating[i] += (armies[neighbor] / armies[fromIndex]) * 20000;
                if(wayMetrix[neighbor] < wayMetrix[fromIndex]) {
                    neighborRating[i] += wayMetrix[neighbor] / wayMetrix[ownGeneral] * 100000;
                }
            }
        }
        let toNeighbor = getMaxArrIndex(neighborRating);
        let toInder = neighbors[toNeighbor];

        lastFrom = fromIndex;
        socket.emit('attack', fromIndex, toInder);

    }
}

function leaveGame() {
    socket.emit('leave_game');
    process.exit();
}

socket.on('game_lost', leaveGame);

socket.on('game_won', leaveGame);

function initialise(data){
    width = data.map_diff[2];
    height = data.map_diff[3];
    size = width * height;
    console.log("size: " + width + " x " + height + " = " + size);
    generals = data.generals;
    initialised = true;
}

/* Returns a new array created by patching the diff into the old array.
 * The diff formatted with alternating matching and mismatching segments:
 * <Number of matching elements>
 * <Number of mismatching elements>
 * <The mismatching elements>
 * ... repeated until the end of diff.
 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
 */
function patch(old, diff) {
    let out = [];
    let i = 0;
    while (i < diff.length) {
        if (diff[i]) {  // matching
            Array.prototype.push.apply(out, old.slice(out.length, out.length + diff[i]));
        }
        i++;
        if (i < diff.length && diff[i]) {  // mismatching
            Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
            i += diff[i];
        }
        i++;
    }
    return out;
}

function patchMap(old, diff) {
    let out = [];
    let i = 0;
    while (i < diff.length) {
        if (diff[i]) {  // matching
            Array.prototype.push.apply(out, old.slice(out.length, out.length + diff[i]));
        }
        i++;
        if (i < diff.length && diff[i]) {  // mismatching
            for(j = 0; j < diff[i]; j++){
                let mapindex = out.length + j;
                if(mapindex > size + 1) {
                    let diffindex = i + j + 1;
                    //iterate through all changed map tiles
                    tileChange(mapindex, diff[diffindex]);
                }
            }
            Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
            i += diff[i];
        }
        i++;
    }
    return out;
}

function tileChange(index, newVal){
    let oldVal = map[index];
    if(oldVal != playerIndex && newVal == playerIndex){
        ownTiles.push(mapToTerrainCoords(index));
    }
    else if(oldVal == playerIndex && newVal != playerIndex){
        ownTiles.splice(ownTiles.indexOf(mapToTerrainCoords(index)), 1);
    }
}

function tu(tileindex){
    if(tileindex <= width){
        return -1;
    }
    return tileindex-width;
}

function tr(tileindex){
    if(tileindex % width == width-1){
        return -1;
    }
    return tileindex+1;
}

function td(tileindex) {
    if(tileindex + width > size){
        return -1;
    }
    return tileindex+width;
}

function tl(tileindex) {
    if(tileindex % width == 0){
        return -1;
    }
    return tileindex-1;
}

function mapToTerrainCoords(mapIndex) {
    return mapIndex-size-2;
}

function getNeighbors(tileindex) {
    return [tu(tileindex), tr(tileindex), td(tileindex), tl(tileindex)].filter(i => i != -1);
}

function getMaxArrIndex(a){
    let maxInd = [0];
    for(let i = 1; i < a.length; i++){
        if(a[i] > a[maxInd[0]]){
            maxInd = [];
            maxInd.push(i);
        }
        else if(a[i] === a[maxInd[0]]){
            maxInd.push(i);
        }
    }
    return maxInd[Math.floor(Math.random()*maxInd.length)];
    //return a.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0);
}

function bfs(start, end) {
    levels = [];
    for(let i = 0; i < terrain.length; i++){
        levels[i] = null;
    }
    levels[start] = 0;
    levelOrderedTiles = [start];
    let q = [start];

    let currLevel = 1;
    let thisLevelItems = 1;
    while(q.length > 0){
        let value = q.shift();
        let neighbors = getNeighbors(value);
        for(let i = 0; i < neighbors.length; i++){
            if(levels[neighbors[i]] === null && terrain[neighbors[i]] !== -2 && terrain[neighbors[i]] !== -4){
                q.push(neighbors[i]);
                levelOrderedTiles.push(neighbors[i]);
                levels[neighbors[i]] = currLevel;
            }
        }
        if(value === end){
            return levels;
        }
        thisLevelItems--;
        if(thisLevelItems == 0){
            currLevel++;
            thisLevelItems = q.length;
        }
    }
    return levels;
}

function wayMetric(){
    for(let i = 0; i < terrain.length; i++){
        wayMetrix[i] = 0;
    }
    //vorher vllt alles auf 0 setzen?
    for(let i = levelOrderedTiles.length - 1; i > -1; i--){
        let currTile = levelOrderedTiles[i];
        let currLevel = levels[currTile];
        let neighbors = getNeighbors(currTile);
        for(let j = 0; j < neighbors.length; j++){
            let nTile = neighbors[j];
            //neighbor level hoeher --> currtile-metric + neighborTileMetric + 1
            if(levels[nTile] > currLevel){
                wayMetrix[currTile] += wayMetrix[nTile] + 1;
            }
        }
    }
}

function getForelastLevel(levels, end){
    let maxLevel = levels[end];
    let forelastLevel = [];
    let neighbors = getNeighbors(end);
    for(let i = 0; i < neighbors.length; i++){
        let nindex = neighbors[i];
        if(levels[nindex] === maxLevel - 1){
            forelastLevel.push(nindex);
        }
    }
    return forelastLevel;
}

function printArr(array){
    let string = "";
    for(let i = 0; i < array.length; i++){
        string += array[i] + " | ";
        if(i % width == width-1){
            string += "\n";
        }
    }
    console.log(string);
}
