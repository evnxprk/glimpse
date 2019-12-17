import { shallowMount, RouterLinkStub } from '@vue/test-utils'
import Vue from 'vue'
import Vuetify from 'vuetify'
import VueRouter from 'vue-router'
import VuetifyOptions from '../vuetify.config'
import TheHeader from '@/components/TheHeader.vue'

Vue.use(VueRouter)
Vue.use(Vuetify)
const vuetifyInstance = new Vuetify(VuetifyOptions)

describe('TheHeader', () => {
  let wrapper
  function mount (opts) {
    wrapper = shallowMount(TheHeader, {
      ...opts,
      vuetify: vuetifyInstance,
      router: new VueRouter(),
      stubs: {
        NuxtLink: RouterLinkStub
      } })
  }

  test('Properly renders', () => {
    mount({})
    expect(wrapper.element).toMatchSnapshot()
  })

  test('Handles opaque top correctly', () => {
    mount({})
    expect(wrapper.find('vappbar-stub').element).toHaveAttribute('color', '#b05454')
  })

  test('Handles transparent top correctly', () => {
    mount({
      propsData: {
        transparentAtTop: true
      }
    })
    expect(wrapper.find('vappbar-stub').element).toHaveAttribute('color', '#00000000')
  })
})
