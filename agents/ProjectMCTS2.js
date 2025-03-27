'use strict';

var Pokemon = require('../zarel/battle-engine').BattlePokemon;
var clone = require('../clone')
var BattleSide = require('../zarel/battle-engine').BattleSide;
var PriorityQueue = require('priorityqueuejs');
const { start } = require('repl');
var util = require('util')
const fs = require('fs');

// All Showdown AI Agents need 4 methods.

// decide takes in an approximation of the current gamestate, an associative array keyed by choices with choice details as value, and a string to remind you what side you are
// decide should return one of the keys in the array of choices.

// assumepokemon takes a name, level, gender, and the side of the pokemon in order to generate a best-guess estimate of the opponent's stats (which is hidden information)

// digest(line) is a way for you to customize how your agent deals with incoming information.  It doesn't have to do anything, but it can

// getTeam(format) should return the team that the agent plans on using.  This is only relevant if playing in a non-random format.

// All agents should also come with an assumptions object, which will guide how the InterfaceLayer deals with various aspects of hidden information.

class ProjectMCTS2 {
    constructor(mode) { 
        this.name = 'ProjectMCTS2';
        this.mode = mode; // expects a boolean - true = adaptive is turned on
        this.oppLastChoiceValues = null;
     }

    fetch_random_key(obj) {
        var temp_key, keys = [];
        for (temp_key in obj) {
            if (obj.hasOwnProperty(temp_key)) {
                keys.push(temp_key);
            }
        }
        return keys[Math.floor(Math.random() * keys.length)];
    }

    decide(gameState, options, mySide, oppLastChoice, activeMaybeTrapped) {
        var d = new Date();
        var n = d.getTime(); // time when decision starts

        var nstate = gameState.copy(); // nstate = new state, deep copy of the current gameState to avoid making direct changes
        nstate.p1.currentRequest = 'move';
        nstate.p2.currentRequest = 'move';

        nstate.me = mySide.n;
        this.mySID = mySide.n;
        this.mySide = mySide.id;

        // not actually commented in previous code so not certain how this works but it seems to send an update to the battle state - isTerminal being if the other side has fainted and badTerminal being if their current request state is forced to switch
        function battleSend(type, data) {
            if (this.sides[1 - this.me].active[0].hp == 0) {
                this.isTerminal = true;
            }
            else if (this.sides[1 - this.me].currentRequest == 'switch' || this.sides[this.me].active[0].hp == 0) {
                this.badTerminal = true;
            }
        }

        nstate.send = battleSend;

        let startNode = new MCTSNode(nstate, null, null, [], 0, 0, 0);
        let currentNode = startNode;
        let nodesInTree = [];
        nodesInTree.push(startNode);

        // a hacky way of checking if we can switch because callback no longer exists
        // ideally i'd be modifying the pokemon themselves but that would require a lot of unpicking
        let hasMove = Object.keys(options).some(function(k){return k.startsWith("move")}); // check if there are any moves in the object
        if(activeMaybeTrapped == true || hasMove){
            for(let opt in options){
                if(opt.startsWith("switch")){
                    delete options[opt];
                }
            }
        }

        // mcts process
        while((new Date()).getTime() - n <= 45000) {
            currentNode = startNode;

            // selection stage
            while(currentNode.children.length > 0){
                currentNode = currentNode.selection(nodesInTree);
            }

            // expansion stage
            if((currentNode.numberOfVisits !== 0 || !currentNode.parent) && !currentNode.state.isTerminal){
                let expandedNodes = currentNode.expansion(options, activeMaybeTrapped);

                for(let nextExpandedNode of expandedNodes){ nodesInTree.push(nextExpandedNode); }
                
                if(expandedNodes.length > 0) {
                    currentNode = expandedNodes[0]; 
                }
            }

            // play-out stage
            let rolloutreturn = currentNode.rollout(options, mySide.id, activeMaybeTrapped, oppLastChoice);
            let rolloutValue = rolloutreturn[0];
            let oppRolloutValue = rolloutreturn[1];

            // backpropogation stage
            currentNode.backpropogate(rolloutValue, oppRolloutValue);
        }
        
        let bestChoiceValue = -Infinity;
        let smallestDifference = Infinity;
        let chosenMove = currentNode.state.baseMove;
        let agentChoiceValues = [];
        let opponentChoiceValues = [];
        let opponentChoiceValuesMap = new Map();
        let oppLastChoiceVal = null;

        // what to do if we have opponent data
        if(this.mode === true && this.oppLastChoiceValues !== null && this.oppLastChoiceValues.size !== 0 && oppLastChoice !== null ){
            oppLastChoiceVal = this.oppLastChoiceValues.get(oppLastChoice);

            if(oppLastChoiceVal !== undefined){
                for(let childNode of startNode.children){
                    // add agent moves to an object to make an average later
                    let agentfound = agentChoiceValues.find(el => el.move === childNode.state.baseMove);
                    if(agentfound){
                        agentfound.allNodeValues += childNode.totalValue;
                        agentfound.numberOfNodes += 1;
                        if(childNode.hasOwnProperty("winner") && childNode.winner === "ParentalBondBot"){
                            agentfound.possiblewin = true;
                        }
                    }
                    else{
                        let possiblewin = childNode.hasOwnProperty("winner") && childNode.winner === "ParentalBondBot";
                        let newAgentChoice = {"move":childNode.state.baseMove,"allNodeValues":childNode.totalValue,"numberOfNodes":1,"possiblewin":possiblewin}
                        agentChoiceValues.push(newAgentChoice);
                    }

                    // add opponent moves to an object to make an average later
                    let oppfound = opponentChoiceValues.find(el => el.move === childNode.state.baseMove);
                    if(oppfound){
                        oppfound.allNodeValues += childNode.totalValue;
                        oppfound.numberOfNodes += 1;
                    }
                    else{
                        let newOppChoice = {"move":childNode.state.baseMove,"allNodeValues":childNode.totalValue,"numberOfNodes":1}
                        opponentChoiceValues.push(newOppChoice);
                    }
                }

                // go through the choices and look for the smallest average difference in value
                for(let choice of agentChoiceValues){
                    let average = choice.allNodeValues / choice.numberOfNodes;
                    let difference = Math.abs(average - oppLastChoiceVal)
                    // exception if we might win
                    if(choice.hasOwnProperty("possiblewin") && choice.possiblewin === true){
                        chosenMove = choice.move;
                        break;
                    }
                    if(difference < smallestDifference){
                        smallestDifference = difference;
                        chosenMove = choice.move;
                    }
                }

                // add mapping for next turn
                for(let choice of opponentChoiceValues){
                    let average = choice.allNodeValues / choice.numberOfNodes;
                    opponentChoiceValuesMap.set(choice.move, average);
                }
            }
        }
        // what to do if we don't have opponent data or if we aren't adapting
        if(this.mode === false || this.oppLastChoiceValues === null || oppLastChoice === null || oppLastChoiceVal === undefined){
            for(let childNode of startNode.children){
                //console.log("child node for", childNode.baseMove, "-", childNode.totalValue);
                // add agent moves to an object to make an average later
                let agentfound = agentChoiceValues.find(el => el.move === childNode.state.baseMove);
                if(agentfound){
                    agentfound.allNodeValues += childNode.totalValue;
                    agentfound.numberOfNodes += 1;
                    //console.log(agentfound.move, "- add", childNode.totalValue, "to get", agentfound.allNodeValues);
                }
                else{
                    let newAgentChoice = {"move":childNode.state.baseMove,"allNodeValues":childNode.totalValue,"numberOfNodes":1}
                    agentChoiceValues.push(newAgentChoice);
                    //console.log(newAgentChoice.move, "- add", childNode.totalValue, "to get", newAgentChoice.allNodeValues);
                }
    
                // build a mapping of the opponent's choices to their values
                // only do this if adaptivity enabled
                if(this.mode === true){
                    let oppfound = opponentChoiceValues.find(el => el.move === childNode.state.baseMove);
                    if(oppfound){
                        oppfound.allNodeValues += childNode.totalValue;
                        oppfound.numberOfNodes += 1;
                    }
                    else{
                        let newOppChoice = {"move":childNode.state.baseMove,"allNodeValues":childNode.totalValue,"numberOfNodes":1}
                        opponentChoiceValues.push(newOppChoice);
                    }
                }
            }

            // get the best move on average
            for(let choice of agentChoiceValues){
                let average = choice.allNodeValues / choice.numberOfNodes;
                //console.log("final choices", choice.move, "-", average);
                if(average > bestChoiceValue){
                    bestChoiceValue = average;
                    chosenMove = choice.move;
                }
            }

            // add mapping for next turn if enabled
            if(this.mode === true){
                for(let choice of opponentChoiceValues){
                    let average = choice.allNodeValues / choice.numberOfNodes;
                    opponentChoiceValuesMap.set(choice.move, average);
                }
            }
        }

        this.oppLastChoiceValues = opponentChoiceValuesMap;

        return chosenMove;
    }

    // A function that takes in a pokemon's name as string and level as integer, and returns a BattlePokemon object.
    // Assumption Engine is designed to fill in the blanks associated with partial observability.
    // This engine in particular assumes perfect IVs and 100 EVs across the board except for speed, with 0 moves. 
    // Other assumption systems can be used as long as they implement assume(pokemon, level)
    assumePokemon(pname, plevel, pgender, side) {
        var template = Tools.getTemplate(pname);
        var nSet = {
            species: pname,
            name: pname,
            level: plevel,
            gender: pgender,
            evs: {
                hp: 85,
                atk: 85,
                def: 85,
                spa: 85,
                spd: 85,
                spe: 85
            },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: "Hardy",
            moves: [],
        };
        for (var moveid in template.randomBattleMoves) {
            nSet.moves.push(toId(template.randomBattleMoves[moveid]));
        }
        var basePokemon = new Pokemon(nSet, side);
        // If the species only has one ability, then the pokemon's ability can only have the one ability.
        // Barring zoroark, skill swap, and role play nonsense.
        // This will be pretty much how we digest abilities as well
        if (Object.keys(basePokemon.template.abilities).length == 1) {
            basePokemon.baseAbility = toId(basePokemon.template.abilities['0']);
            basePokemon.ability = basePokemon.baseAbility;
            basePokemon.abilityData = { id: basePokemon.ability };
        }
        return basePokemon;
    }

    digest(line) {
    }

    getTeam(format) {
    }
}

// cs310 referenced
class MCTSNode {
    constructor(state, oppChoice, parent, children, totalValue, oppTotalValue, numberOfVisits){
        this.state = state;
        this.oppChoice = oppChoice;
        this.parent = parent;
        this.children = children;
        this.totalValue = totalValue;
        this.oppTotalValue = oppTotalValue;
        this.numberOfVisits = numberOfVisits;
    }

    calculateUCB() {
        if(this.numberOfVisits === 0){ return Infinity }
        
        else {
            let valueAverage = this.totalValue/this.numberOfVisits;
            let tunableParam = 2;
            
            let rootNode = this;
            while (rootNode.parent !== null) {
                rootNode = rootNode.parent;
            }

            let ucb = valueAverage + tunableParam * Math.sqrt(Math.log(rootNode.numberOfVisits)/this.numberOfVisits);
            return ucb;
        }
    }

    selection(nodeTree) {
        let maxUCBVal = -Infinity;
        let selectedNode;

        for (let nextNode of nodeTree){
            if (nextNode.parent === this){
                let succUCB = nextNode.calculateUCB();

                if (succUCB > maxUCBVal){
                    maxUCBVal = succUCB;
                    selectedNode = nextNode;
                }
            }
        }
        
        return selectedNode;
    }

    // --- code from minimax agent begin --- //

    getOptions(state, player, activeMaybeTrapped) {
        if (typeof (player) == 'string' && player.startsWith('p')) {
            player = parseInt(player.substring(1)) - 1;
        }

        let options = Tools.parseRequestData(state.sides[player].getRequestData());
        // arena trap / shadow tag / magnet pull don't seem to be handled properly elsewhere anymore
        // this removes switching as an option if possibly trapped to avoid hanging at error
        let hasMove = Object.keys(options).some(function(k){return k.startsWith("move")});
        if(activeMaybeTrapped == true || hasMove){
            for(let opt in options){
                if(opt.startsWith("switch")){
                    delete options[opt];
                }
            }
        }

        return options;
    }

    evaluateState(state, oppLastChoice) {
        /*
        // agent's total hp of the team in the back
        let mytotalhp = 0;
        for(let pokemon of state.sides[state.me].pokemon){
            if(pokemon.species !== state.sides[state.me].active[0].species){
                mytotalhp += pokemon.hp / pokemon.maxhp;
            }
        }

        let theirtotalhp = 0;
        for(let pokemon of state.sides[1 - state.me].pokemon){
            if(pokemon.species !== state.sides[1 - state.me].active[0].species){
                theirtotalhp += pokemon.hp / pokemon.maxhp;
            }
        }

        // if we don't know about a mon yet, it must be at full hp (1)
        let knownPokemon = state.sides[1 - state.me].pokemon.length;
        while(knownPokemon < 6){
            theirtotalhp += 1
            knownPokemon++
        }
        */

        var myp = state.sides[state.me].active[0].hp / state.sides[state.me].active[0].maxhp;
        var thp = state.sides[1 - state.me].active[0].hp / state.sides[1 - state.me].active[0].maxhp;

        let agentEval = (myp) - (thp) - (0.3 * state.turn);
        let playerEval = (thp) - (myp) - (0.3 * state.turn);

        return [agentEval, playerEval];
        
    }

    // --- code from minimax agent end --- //

    nextstates(state, options, activeMaybeTrapped){
        let nstate = state.copy();
        let player = nstate.me;
        let states = [];
        let oppChoicesMap = new Map();

        if(nstate.sides[player].currentRequest === "switch" && nstate.sides[1 - player].currentRequest !== "switch"){
            for(let switchChoice in options){
                let cstate = nstate.copy();

                cstate.baseMove = switchChoice;

                cstate.choose('p' + (player + 1), switchChoice);
                cstate.choose('p' + (1 - player + 1), 'forceskip');
                
                if(cstate){
                    states.push(cstate);
                }
            }
        }
        else if(nstate.sides[1 - player].currentRequest === "switch" && nstate.sides[player].currentRequest !== "switch"){
            let switchChoices = this.getOptions(nstate, 1 - player, activeMaybeTrapped);
            for(let switchChoice in switchChoices){
                let cstate = nstate.copy();

                cstate.choose('p' + (player + 1), 'forceskip');
                cstate.choose('p' + (1 - player + 1), switchChoice);

                if(cstate){
                    states.push(cstate);

                    let stateIndex = states.indexOf(cstate);
                    oppChoicesMap.set(stateIndex, switchChoice);
                }
            }
        }
        else{
            for (let choice in options){
                let oppChoices = this.getOptions(nstate, 1 - player, activeMaybeTrapped);
    
                for (let oppChoice in oppChoices){
                    let cstate = nstate.copy();
                    cstate.baseMove = choice;

                    cstate.choose('p' + (player + 1), choice);
                    cstate.choose('p' + (1 - player + 1), oppChoice);
                    
                    if(cstate){
                        states.push(cstate);

                        let stateIndex = states.indexOf(cstate);
                        oppChoicesMap.set(stateIndex, oppChoice);
                    }
                }
            }
        }
        return [states, oppChoicesMap];
    }

    expansion(options, activeMaybeTrapped) {
        let nodeList = [];
        let nextstatesreturn = this.nextstates(this.state, options, activeMaybeTrapped);
        let successors = nextstatesreturn[0];
        let oppChoicesMap = nextstatesreturn[1];
        
        let stateIndex = 0;
        for (let successorState of successors){
            let oppChoice = oppChoicesMap.get(stateIndex);

            let nextNode = new MCTSNode(successorState, oppChoice, this, [], 0, 0, 0);
            nodeList.push(nextNode);

            this.children.push(nextNode);
            stateIndex++;
        }
        return nodeList
    
    }

    rollout(options, sideID, activeMaybeTrapped, oppLastChoice){
        let initialState = this.state;
        let currentState = this.state;
        let currentOptions = options;
        let rolloutDepth = 2;

        for (let i = 0; i < rolloutDepth; i++){
            if(currentState.isTerminal || currentState.badTerminal || currentState.hasOwnProperty("winner")){ break; }

            currentOptions = this.getOptions(currentState, sideID, activeMaybeTrapped);
            let nextstatesreturn = this.nextstates(currentState, currentOptions, activeMaybeTrapped);
            let successors = nextstatesreturn[0];
            let oppChoicesMap = nextstatesreturn[1];
            let choiceIndex = Math.floor(Math.random() * successors.length);

            oppLastChoice = oppChoicesMap.get(choiceIndex);

            currentState = successors[choiceIndex];
        }

        return this.evaluateState(currentState, oppLastChoice);
    }

    backpropogate(rolloutValue, oppRolloutValue){
        let currentNode = this;
        while (true){
            currentNode.totalValue += rolloutValue
            currentNode.oppTotalValue += oppRolloutValue
            currentNode.numberOfVisits += 1
            if (currentNode.parent === null) { break }
            else { currentNode = currentNode.parent }
        }
    }
}

exports.Agent = ProjectMCTS2;