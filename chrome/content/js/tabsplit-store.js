/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/**
 * @params win {Object} ChromeWindow
 */
(function (win) {
"use strict";

if (!win.TabSplit) {
  win.TabSplit = {};
}
const TabSplit = win.TabSplit;

TabSplit.store = {

  // TODO: Maybe could remove this
  TAB_GROUP_ID_PREFIX: "tabsplit-tab-group-id-",

  VALID_LAYOUTS: [ "column_split" ],

  // We do incremental id
  _tabGroupIdCount: 0,
  
  // Listeners for the state change.
  // One listener is a object having `onStateChange` function with the signature below:
  //   - store {object} TabSplit.store
  //   - tabGroupsDiff {Object} the tabGroups state diff after the state changes.
  //        This is to let ouside quickly know what changes on tabGroups.
  //        Holds 3 properties:
  //        - added {Array} the newly added tabGroups' id
  //        - removed {Array} the removed tabGroups' id
  //        - updated {Array} the updated tabGroups'  // TODO: Maybe this is useless
  _listeners: null,

  // This object stores the current state, which includes
  //
  // status {String} the status of TabSplit function, could be "status_active", "status_inactive", "status_destroyed".
  //                 All other states will be reset if the status is "status_inactive".
  //                 All other states and listeners will be cleared if the status is "status_destroyed".
  //
  // windowWidth {Number} the current window width
  //
  // selectedLinkedPanel {String} the selected tab's linkedPanel attribute value
  //
  // tabGroupIds {Array} The array of tab group ids. The order represents tab groups' order.
  //
  // tabGroups {Object} holds instances of TabGroup, see below for TabGroup. Key is tab group id.
  // 
  // TabGroup is one object holding info of one group of tabs being split
  // - id {Number} this tabGroup id (Should never allow any update on the id).
  // - color {String} #xxxxx used for visually grouping tabs
  // - layout {String} see `VALID_LAYOUTS` for the valid values
  // - tabs {Array} instances of Tab, see below for Tab details.
  //                The order represents tabs' order: The smaller col comes first.
  // 
  // Tab is one object holding info of one split tab in one tab group
  // - linkedPanel {String} the tab's linkedPanel attribute value
  // - col: {Number} the column index where the tab locate. 0 is the left most column.
  // - distribution {Number} 0 ~ 1. The percentage of window width this tab occupies
  _state: null,

  _resetState() {
    this._state = {
      status: "status_inactive",
      windowWidth: -1,
      selectedLinkedPanel: "",
      tabGroupIds: [],
      tabGroups: {},
    };
  },

  /**
   * @params params {Object}
   *    - utils {Object} TabSplit.utils
   */
  init(params) {
    let { utils } = params;
    this._utils = utils;
    this._resetState();
    this._tabGroupIdCount = 0;
    this._listeners = new Set();
  },

  getState() {
    return this._copy(this._state);
  },

  /**
   * Should call this to udpate states.
   * 
   * @params actions {Object} state update actions. See Action below for details
   *
   * Action is an object describing the state update action, holding:
   *  - type {String} the action type
   *  - value {*} the new state value. The format depends on the `type` property. 
   * The valid actions are:
   *  - type: "set_active"
   *  - value: null, not required
   *
   *  - type: "set_inactive"
   *  - value: null, not required
   *
   *  - type: "set_destroyed"
   *  - value: null, not required
   *
   *  - type: "update_window_width"
   *  - value: {Number} the crruent window width
   *
   *  - type: "update_selected_linkedPanel"
   *    value: {String} see `selectedLinkedPanel` in `_state`
   *
   *  - type: "add_tab_group". This will add to the end.
   *    value: {Object} see TabGroup in `_state`
   *
   *  - type: "remove_tab_group"
   *    value: {Number} the id of tabGroup in `_state`
   *
   *  - type: "update_tab_distibutions".
   *    value:
   *      - id {Number} the id of the group to update.
   *      - distributions {Array} the new tabs' distributions
   */
  update(...actions) {
    let added = [];
    let removed = [];
    let updated = [];
    let dirty = false;
    for (let action of actions) {
      try {
        if (this._state.status == "status_destroyed") {
          throw "The current status is destroyed, please init again before updating any state";
        }

        let v = action.value;
        switch (action.type) {
          case "set_active":
            if (this._state.status != "status_active") {
              this._state.status = "status_active";
              dirty = true;
            } else {
              throw "Set active on the status that is already active";
            }
            break;

          case "set_inactive":
            if (this._state.status == "status_active") {
              this._state.status = "status_inactive";
              dirty = true;
            } else {
              throw "Set inactive on the status that is not active";
            }
            break;

          case "set_destroyed":
            this._state.status = "status_destroyed";
            dirty = true;
            break;

          case "update_window_width":
            if (v <= 0) {
              throw `Invalid window width of ${v}`;
            }
            if (v !== this._state.windowWidth) {
              this._state.windowWidth = v;
              dirty = true;
            }
            break;

          case "update_selected_linkedPanel":
            if (!this._utils.getTabByLinkedPanel(v)) {
              throw `Unknown selected linkedPanel of ${v}`;
            }
            this._state.selectedLinkedPanel = v;
            dirty = true;
            break;

          case "add_tab_group":
            let newId = this._addTabGroup(v);
            added.push(newId);
            dirty = true;
            break;

          case "remove_tab_group":
            this._removeTabGroup(v);
            removed.push(v);
            dirty = true;
            break;

          case "update_tab_distibutions":
            this._updateTabDistributions(v.id, v.distributions);
            updated.push(v.id);
            dirty = true;
            break;

          default:
            throw `Unknow action type of ${action.type}`;
        }
      } catch(e) {
        console.error(`Fail at the update action of ${action.type}`);
        console.error(e);
        return;
      }
    }

    if (dirty) {
      if (this._state.status == "status_inactive") {
        this._resetState();
      } else if (this._state.status == "status_destroyed") {
        // A simple way to clear all other states except for the status state
        this._state = { status: "status_destroyed" };
      }

      this._listeners.forEach(listener => {
        // TODO: Should we pass a copy of `{ added, removed, updated }`
        // in case that outside modifies these important variables?
        listener.onStateChange(this, { added, removed, updated });
      });

      if (this._state.status == "status_destroyed") {
        this._listeners.clear();
        this._listeners = null;
      }
    }
  },

  /**
   * @return the new tabGroup id
   */
  _addTabGroup(newTabGroup) {
    let { tabs, color, layout } = newTabGroup;

    if (!this.VALID_LAYOUTS.includes(layout)) {
      throw `Invalid split layout: ${layout}`;
    }

    if (color == "") {
      throw "Lack the color property";
    }

    if (tabs.length != 2) {
      throw `Unexpected tabs length of ${tabs.length}`;
    }

    let seenPanels = [];
    let distributionSum = 0;
    for (let i = 0; i < tabs.length; i++) {
      let t = tabs[i];
      if (t.col != i) {
        // Maybe we should relax this check and do sorting if needed.
        throw `The tab with linkedPanel of ${t.linkedPanel} has array position ${i} different from column position ${t.col}`;
      }
      if (!this._isValidTab(t)) {
        throw `The tab with linkedPanel of ${t.linkedPanel} being added is invalid`;
      }
      if (this._utils.getTabGroupByLinkedPanel(t.linkedPanel, this._state)) {
        throw `The tab with linkedPanel of ${t.linkedPanel} being added is already split`;
      }
      if (seenPanels.includes(t.linkedPanel)) {
        throw `Cannot add the tab with linkedPanel of ${t.linkedPanel} twice in one tab group`;
      }
      seenPanels.push(t.linkedPanel);
      distributionSum += t.distribution;
    }
    if (distributionSum != 1) {
      let panels = tabs.map(t => t.linkedPanel);
      throw `Expect the sum of tabs' distributions to be 1 but get ${distributionSum} from ${panels.join(', ')}`;
    }

    // NOTE: What if redundant props passed with newTabGroup
    let newGroup = this._copy(newTabGroup);
    newGroup.id = this.TAB_GROUP_ID_PREFIX + this._tabGroupIdCount++;
    this._state.tabGroups[newGroup.id] = newGroup;
    this._state.tabGroupIds.push(newGroup.id);
    return newGroup.id;
  },

  _removeTabGroup(id) {

  },

  _updateTabDistributions(id, distributions) {

  },

  _copy(obj) {
    // We don't wanna give outside any chance to mutaute our state
    // so make a copy when returning/receiving states.
    // NOTE:
    // The state only contains Number/String and is simple so we can do this copy trick.
    // Maybe we should borrow from immutable.js when the state gets complex.
    return JSON.parse(JSON.stringify(obj));
  },

  _isValidTab(tab) {
    let { col, distribution, linkedPanel } = tab;
    if ((col < 0 || col > 1 ) ||
        (distribution <= 0 || distribution >= 1) ||
        !this._utils.getTabByLinkedPanel(tab.linkedPanel)) {
      return false;
    }
    return true;
  },

  /**
   * @param listener {Function} See `_listeners`
   */
  subscribe(listener) {
    if (!this._listeners.has(listener)) {
      this._listeners.add(listener);
    }
  },

  /**
   * @param listener {Function} See `_listeners`
   */
  unsubscribe(listener) {
    if (this._listeners.has(listener)) {
      this._listeners.delete(listener);
    }
  },
};

})(this);
