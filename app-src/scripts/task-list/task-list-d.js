/**
 * @ngdoc component
 * @name superProductivity.directive:taskList
 * @description
 * # taskList
 */

(function() {
  'use strict';

  const CONTROLLER_AS = '$ctrl';
  const KEY_LEFT = 37;
  const KEY_UP = 38;
  const KEY_RIGHT = 39;
  const KEY_DOWN = 40;

  class TaskListCtrl {
    /* @ngInject */
    constructor(Dialogs, $rootScope, $mdToast, $timeout, Tasks, EDIT_ON_CLICK_TOGGLE_EV, $scope, ShortSyntax, $element, Jira, CheckShortcutKeyCombo, Util) {
      this.Dialogs = Dialogs;
      this.$mdToast = $mdToast;
      this.$timeout = $timeout;
      this.Tasks = Tasks;
      this.EDIT_ON_CLICK_TOGGLE_EV = EDIT_ON_CLICK_TOGGLE_EV;
      this.$scope = $scope;
      this.ShortSyntax = ShortSyntax;
      this.$element = $element;
      this.Jira = Jira;
      this.$rootScope = $rootScope;
      this.lastFocusedTaskEl = undefined;
      this.checkKeyCombo = CheckShortcutKeyCombo;
      this.Util = Util;
      // this.selectCurrentTaskTimeout;

      this.boundHandleKeyPress = this.handleKeyPress.bind(this);
      this.boundFocusLastTaskEl = this.focusLastFocusedTaskEl.bind(this);
    }

    $onDestroy() {
      this.$timeout.cancel(this.animationReadyTimeout);
      this.$timeout.cancel(this.selectCurrentTaskTimeout);
    }

    $onInit() {
      // only allow after short delay
      this.animationReadyTimeout = this.$timeout(() => {
        this.$element.addClass('is-animation-ready');
      }, 400);

      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      // NOTE: Take good care not to update the dom (scope) structure
      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      function getParenTaskFromDestScope(destSortableScope) {
        return destSortableScope.$parent[CONTROLLER_AS].parentTask;
      }

      this.dragControlListeners = {
        accept: (sourceItemHandleScope, destSortableScope) => {
          if (this.disableDropInto) {
            return false;
          } else {
            // disallow parent tasks to be dropped into parent tasks
            let draggedTask = sourceItemHandleScope.itemScope.task;
            return !(draggedTask.subTasks && draggedTask.subTasks.length > 0 && getParenTaskFromDestScope(destSortableScope));
          }
        },
        itemMoved: function(event) {
          let currentlyMovedTask = event.dest.sortableScope.modelValue[event.dest.index];
          let parentTask = getParenTaskFromDestScope(event.dest.sortableScope);

          if (parentTask) {
            currentlyMovedTask.parentId = parentTask.id;
          } else {
            if (!angular.isUndefined(currentlyMovedTask.parentId)) {
              delete currentlyMovedTask.parentId;
            }
          }

          if (angular.isFunction(this.onItemMoved)) {
            this.onItemMoved({
              currentlyMovedTask,
              parentTask,
              $event: event
            });
          }
        },
        orderChanged: function(event) {
          if (angular.isFunction(this.onOrderChanged)) {
            this.onOrderChanged({ $event: event });
          }
        },
        allowDuplicates: false,
        containment: '#board'
      };
    }

    focusPreviousInListOrParent($index) {
      let taskEls = angular.element(this.$element.children().children());
      let focusTaskEl;

      // NOTE!!! element has not yet been removed from the dom
      if (taskEls.length > 1) {
        // if is last
        if (taskEls.length === $index + 1) {
          focusTaskEl = angular.element(taskEls[$index - 1]);
        } else {
          focusTaskEl = angular.element(taskEls[$index + 1]);
        }
      } else if (this.parentTask) {
        focusTaskEl = angular.element(this.$element.parent()).parent();
      }

      if (focusTaskEl) {
        focusTaskEl.focus();
      }
    }

    focusTaskEl(taskEl) {
      if (taskEl) {
        taskEl.focus();
      }
    }

    focusLastFocusedTaskEl() {
      if (this.lastFocusedTaskEl) {
        this.focusTaskEl(this.lastFocusedTaskEl);
      }
    }

    focusCurrentTask() {
      if (this.selectCurrentTaskTimeout) {
        this.$timeout.cancel(this.selectCurrentTaskTimeout);
      }

      this.selectCurrentTaskTimeout = this.$timeout(() => {
        const currentTask = document.querySelectorAll('.task.is-current');
        if (currentTask && currentTask[0]) {
          currentTask[0].focus();
        }
      });
    }

    estimateTime(task) {
      this.Dialogs('TIME_ESTIMATE', { task })
        .then(this.boundFocusLastTaskEl, this.boundFocusLastTaskEl);
    }

    deleteTask(task, $index) {
      const that = this;
      // create copy for undo
      let taskCopy = angular.copy(task);

      if (!$index && $index !== 0) {
        $index = _.findIndex(this.tasks, (taskFromAllTasks) => {
          return taskFromAllTasks.id === task.id;
        });
      }

      //delete
      this.tasks.splice($index, 1);
      this.focusPreviousInListOrParent($index);

      // check if current task was deleted and unset current task if so
      if (this.$rootScope.r.currentTask && this.$rootScope.r.currentTask.id === task.id) {
        this.Tasks.updateCurrent(undefined);
      }

      // show toast for undo
      let toast = this.$mdToast.simple()
        .textContent('You deleted "' + task.title + '"')
        .action('UNDO')
        .hideDelay(15000)
        .position('bottom');

      this.$mdToast.show(toast)
        .then(function(response) {
          if (response === 'ok') {
            // re-add task on undo
            that.tasks.splice($index, 0, taskCopy);
          }
        })
        // we need an empty catch to prevent the unhandled rejection error
        .catch(() => {
        });
    }

    onChangeTitle(task, isChanged, newVal) {
      if (isChanged && newVal) {
        // we need to do this, as the pointer might not have been updated yet
        task.title = newVal;
        this.ShortSyntax(task);
      }
    }

    onTaskNotesEditFinished(newNoteVal, isChanged, task) {
      if (task.originalKey && isChanged) {
        // for some reason, this isn't updated for the task, so we do it here once more
        task.notes = newNoteVal;
        this.Jira.updateIssueDescription(task);
      }

      this.focusLastFocusedTaskEl();
    }

    onTaskDoneChanged(task) {
      if (task.isDone) {
        this.Tasks.markAsDone(task);
      }

      if (angular.isFunction(this.onTaskDoneChangedCallback)) {
        this.onTaskDoneChangedCallback({ task, taskList: this.tasks });
      }
    }

    focusPrevTask(currentTaskEl) {
      const taskEls = document.querySelectorAll('.task');
      const index = Array.prototype.indexOf.call(taskEls, currentTaskEl[0]);
      const nextEl = taskEls[index - 1] || taskEls[0];
      nextEl.focus();
    }

    focusNextTask(currentTaskEl) {
      const taskEls = document.querySelectorAll('.task');
      const index = Array.prototype.indexOf.call(taskEls, currentTaskEl[0]);
      const nextEl = taskEls[index + 1] || currentTaskEl[0];
      nextEl.focus();
    }

    onFocus($event) {
      let taskEl = $event.currentTarget || $event.srcElement || $event.originalTarget;
      taskEl = angular.element(taskEl);
      this.lastFocusedTaskEl = taskEl;
      taskEl.on('keydown', this.boundHandleKeyPress);
    }

    onBlur($event) {
      let taskEl = $event.currentTarget || $event.srcElement || $event.originalTarget;
      taskEl = angular.element(taskEl);
      taskEl.off('keydown', this.boundHandleKeyPress);
    }

    handleKeyPress($ev) {
      let taskEl = $ev.currentTarget || $ev.srcElement || $ev.originalTarget;
      taskEl = angular.element(taskEl);
      const task = this.lastFocusedTaskEl.scope().modelValue;
      const lsKeys = this.$rootScope.r.keys;
      const isShiftOrCtrlPressed = ($ev.shiftKey === false && $ev.ctrlKey === false);
      const getTaskIndex = () => {
        return _.findIndex(this.tasks, (cTask) => {
          return cTask.id === task.id;
        });
      };

      if (this.checkKeyCombo($ev, lsKeys.taskEditTitle) || $ev.key === 'Enter') {
        this.$scope.$broadcast(this.EDIT_ON_CLICK_TOGGLE_EV, task.id);
      }
      if (this.checkKeyCombo($ev, lsKeys.taskToggleNotes)) {
        task.showNotes = !task.showNotes;

        if (task.showNotes) {
          this.$timeout(() => {
            taskEl.find('marked-preview').focus();
          });
        }
      }
      if (this.checkKeyCombo($ev, lsKeys.taskOpenEstimationDialog)) {
        this.estimateTime(task);
      }
      if (this.checkKeyCombo($ev, lsKeys.taskToggleDone)) {
        task.isDone = !task.isDone;
        this.onTaskDoneChanged(task);
      }
      if (this.checkKeyCombo($ev, lsKeys.taskAddSubTask)) {
        this.addSubTask(task);
      }
      if (this.checkKeyCombo($ev, lsKeys.moveToBacklog)) {
        this.Tasks.moveTaskFromTodayToBackLog(task);
      }
      if (this.checkKeyCombo($ev, lsKeys.taskOpenOriginalLink)) {
        this.Util.openExternalUrl(task.originalLink);
      }

      if (this.checkKeyCombo($ev, lsKeys.togglePlay)) {
        this.expandSubTasks(task);
        this.togglePlay(task);
      }

      if (this.checkKeyCombo($ev, lsKeys.taskDelete)) {
        this.deleteTask(task);
        // don't propagate to next focused element (important to allow global keyboard shortcuts)
        $ev.preventDefault();
        $ev.stopPropagation();
      }
      if (this.checkKeyCombo($ev, lsKeys.moveToTodaysTasks)) {
        this.Tasks.moveTaskFromBackLogToToday(task);
      }

      // move focus up
      if ((isShiftOrCtrlPressed && $ev.keyCode === KEY_UP) || this.checkKeyCombo($ev, lsKeys.selectPreviousTask)) {
        this.focusPrevTask(taskEl);

        // stop propagation to prevent from occurring twice (important to allow global keyboard shortcuts)
        $ev.preventDefault();
        $ev.stopPropagation();
      }
      // move focus down
      if ((isShiftOrCtrlPressed && $ev.keyCode === KEY_DOWN) || this.checkKeyCombo($ev, lsKeys.selectNextTask)) {
        this.focusNextTask(taskEl);

        // stop propagation to prevent from occurring twice (important to allow global keyboard shortcuts)
        $ev.preventDefault();
        $ev.stopPropagation();
      }

      // expand sub tasks
      if (($ev.keyCode === KEY_RIGHT) || this.checkKeyCombo($ev, lsKeys.expandSubTasks)) {
        // if already opened or is sub task select next task
        if ((task.subTasks && task.subTasks.length > 0 && task.isHideSubTasks === false) || this.parentTask) {
          this.focusNextTask(taskEl);

          // stop propagation to prevent from occurring twice (important to allow global keyboard shortcuts)
          $ev.preventDefault();
          $ev.stopPropagation();
        }

        this.expandSubTasks(task);
      }

      // collapse sub tasks
      if (($ev.keyCode === KEY_LEFT) || this.checkKeyCombo($ev, lsKeys.collapseSubTasks)) {
        if (task.subTasks) {
          this.collapseSubTasks(task);
        }
        if (this.parentTask) {
          this.focusPrevTask(taskEl);
        }
      }

      // moving items
      // move task up
      if (this.checkKeyCombo($ev, lsKeys.moveTaskUp)) {
        const taskIndex = getTaskIndex();
        if (taskIndex > 0) {
          TaskListCtrl.moveItem(this.tasks, taskIndex, taskIndex - 1);

          // we need to manually re-add focus after timeout
          this.$timeout(() => {
            taskEl.focus();
          });
        }
      }
      // move task down
      if (this.checkKeyCombo($ev, lsKeys.moveTaskDown)) {
        const taskIndex = getTaskIndex();
        if (taskIndex < this.tasks.length - 1) {
          TaskListCtrl.moveItem(this.tasks, taskIndex, taskIndex + 1);
        }
      }

      // finally apply
      this.$scope.$apply();
    }

    expandSubTasks(task) {
      if (task.subTasks) {
        task.isHideSubTasks = false;
      }
    }

    collapseSubTasks(task) {
      if (task.subTasks) {
        const hasCurrentTaskAsSubTask = !!(task.subTasks.find((task) => this.currentTaskId === task.id));

        if (!hasCurrentTaskAsSubTask) {
          task.isHideSubTasks = true;
        }
      }
    }

    addSubTask(task) {
      // use parent task if the current task is a sub task itself
      if (this.parentTask) {
        task = this.parentTask;
      }
      this.expandSubTasks(task);

      // only allow if task is not done
      if (!task.isDone) {
        if (!task.subTasks) {
          task.subTasks = [];
          // save original values for potential later re-initialization
          task.mainTaskTimeEstimate = task.timeEstimate;
          task.mainTaskTimeSpent = task.timeSpent;
          task.mainTaskTimeSpentOnDay = task.timeSpentOnDay;
        }
        let subTask = this.Tasks.createTask({
          title: '',
          parentId: task.id
        });
        // edit title right away
        task.subTasks.push(subTask);

        // focus the new element to edit it right away
        // timeout is needed to wait for dom to update
        this.$timeout(() => {
          this.$scope.$broadcast(this.EDIT_ON_CLICK_TOGGLE_EV, subTask.id);
        });
        // if parent was current task, mark sub task as current now
        if (this.currentTaskId === task.id) {
          this.Tasks.updateCurrent(subTask);
        }
      }
    }

    togglePlay(task) {
      if (this.currentTaskId === task.id) {
        this.Tasks.updateCurrent(undefined);
      } else {
        if (task.subTasks) {
          const firstUndone = task.subTasks.find((cTask) => !cTask.isDone);
          if (firstUndone) {
            this.Tasks.updateCurrent(firstUndone);
          }
        } else {
          this.Tasks.updateCurrent(task);
        }
      }

      if (this.currentTaskId) {
        this.focusCurrentTask();
      }
    }

    static moveItem(array, oldIndex, newIndex) {
      array.splice(newIndex, 0, array.splice(oldIndex, 1)[0]);
    }
  }

  // hacky fix for ff
  TaskListCtrl.$$ngIsClass = true;

  angular
    .module('superProductivity')
    .controller('TaskListCtrl', TaskListCtrl)
    .component('taskList', {
      templateUrl: 'scripts/task-list/task-list-d.html',
      bindToController: true,
      controller: 'TaskListCtrl',
      controllerAs: CONTROLLER_AS,
      bindings: {
        tasks: '=',
        currentTaskId: '<',
        limitTo: '@',
        filter: '<',
        isSubTasksDisabled: '@',
        allowTaskSelection: '@',
        disableDropInto: '@',
        onItemMoved: '&',
        onOrderChanged: '&',
        onTaskDoneChangedCallback: '&onTaskDoneChanged',
        parentTask: '='
      }
    });
})();
