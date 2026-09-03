import { ref } from 'vue'

/**
 * Shares pointer drag reordering between ordered settings lists.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<string[]>} options.items
 * @param {string} options.rowSelector
 * @param {(items: string[]) => unknown} options.updateItems
 * @param {(itemId: string, position: number) => void} options.announceMoved
 */
export function useOrderedItemDrag({ items, rowSelector, updateItems, announceMoved }) {
  const draggedItemId = ref(null)
  const dropTarget = ref(null)

  function startDragging(event, itemId) {
    draggedItemId.value = itemId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', itemId)
    const row = event.currentTarget.closest(rowSelector)
    if (row !== null) event.dataTransfer.setDragImage(row, 20, 20)
  }

  function handleDragOver(event, itemId) {
    if (draggedItemId.value == null || draggedItemId.value === itemId) {
      dropTarget.value = null
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    dropTarget.value = {
      id: itemId,
      after: event.clientY >= bounds.top + bounds.height / 2,
    }
    event.dataTransfer.dropEffect = 'move'
  }

  function dropItem(event, itemId) {
    const draggedId = draggedItemId.value
    if (draggedId == null || draggedId === itemId) {
      stopDragging()
      return
    }

    const sourceIndex = items.value.indexOf(draggedId)
    const targetIndex = items.value.indexOf(itemId)
    if (sourceIndex === -1 || targetIndex === -1) {
      stopDragging()
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    let insertIndex = targetIndex + (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0)
    const reordered = items.value.slice()
    reordered.splice(sourceIndex, 1)
    if (sourceIndex < insertIndex) insertIndex--
    reordered.splice(insertIndex, 0, draggedId)
    updateItems(reordered)
    announceMoved(draggedId, insertIndex)
    stopDragging()
  }

  function stopDragging() {
    draggedItemId.value = null
    dropTarget.value = null
  }

  return {
    draggedItemId,
    dropTarget,
    dropItem,
    handleDragOver,
    startDragging,
    stopDragging,
  }
}
