import DynamicBannerCanvas from './DynamicBannerCanvas.jsx'

/** @deprecated Prefer `<DynamicBannerCanvas designType={3} … />` */
export default function BannerCanvas3(props) {
  return <DynamicBannerCanvas designType={3} {...props} />
}
