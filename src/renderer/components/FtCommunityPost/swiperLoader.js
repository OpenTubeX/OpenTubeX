let swiperModulesPromise = null

export function loadSwiperModules() {
  swiperModulesPromise ??= Promise.all([
    import('swiper/element'),
    import('swiper/modules'),
  ]).then(([{ register }, { A11y, Navigation, Pagination }]) => {
    register()
    return { A11y, Navigation, Pagination }
  }).catch(error => {
    swiperModulesPromise = null
    throw error
  })
  return swiperModulesPromise
}
